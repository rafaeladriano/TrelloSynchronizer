// ### Bibliotecas Usadas ###

var http = require('http');
var OAuth = require('oauth').OAuth;
var url = require('url');
var express = require('express');
var serveStatic = require('serve-static');
var sql = require('mssql');
var fileSystem = require('fs');
var propertiesReader = require('properties-reader');
var log4js = require('log4js');

// ### Propriedades do Servidor ###

var domain = null;
var port = null;
var host = null;
var hostTrelloAPI = "https://api.trello.com/1/";
var app = express();
var properties = null;
var logger = log4js.getLogger();

// ### Propriedades para Autenticação ###

var appName = "Trello Synchronizer";
var requestURL = "https://trello.com/1/OAuthGetRequestToken";
var accessURL = "https://trello.com/1/OAuthGetAccessToken";
var authorizeURL = "https://trello.com/1/OAuthAuthorizeToken";

var key = null;
var secret = null;

var oauth = null;
var oauth_secrets = {};
var oauth_verifier = null;
var oauth_token = null;

var databaseConfig = {
    user: null,
    password: null,
    server: null,
    database: null
};

// ### Estruturas de dados ###

var queryTasks;

var boardSync = {
	boardId : null,
	listId : null
};

var labelsPriority = ["blue", "blue", "orange", "red"];

var databaseTasks = [];
var trelloCards = [];

// ### Lê arquivos de configurações ###

log4js.configure('log_configuration.json', { reloadSecs: 300 });

fileSystem.readFile('./tasks.sql', 'utf8', function (error, data) {
	if (error) {
		logger.error(error);
	} else {
		logger.info('Query das tarefas carregado com sucesso do arquivo "tasks.sql"');
		queryTasks = data;	
	}
});

properties = propertiesReader('./configuration.properties');

databaseConfig.user = properties.get('com.synchronizer.database.user');
databaseConfig.password = properties.get('com.synchronizer.database.password');
databaseConfig.server = properties.get('com.synchronizer.database.host');
databaseConfig.database = properties.get('com.synchronizer.database.databaseName');

key = properties.get('com.synchronizer.trello.key');
secret = properties.get('com.synchronizer.trello.secret');

domain = properties.get('com.synchronizer.server.domain');
port = properties.get('com.synchronizer.server.port');
host = "http://" + domain + ":" + port;

oauth = new OAuth(requestURL, accessURL, key, secret, "1.0", host + "/afterLogin", "HMAC-SHA1")

// ### Funções Auxiliares ###

app.use(serveStatic('./public_html', {'index': ['index.html']}));

var toTask = function(record) {
	return {
		id : record.id,
		title : record.title,
		priority : record.priority,
		hasClient : record.hasClient,
		due : record.due
	};
};

var toCard = function(task) {

	var labelsAux = [];
	labelsAux.push(labelsPriority[task.priority]);

	return {
		name : task.id + ' - ' + task.title,
		due : task.due,
		labels :  labelsAux,
		idList : boardSync.listId,
		urlSource : null
	};
};

var addTrelloCard = function(card) {
	oauth.getOAuthAccessToken(oauth_token, oauth_secrets[oauth_token], oauth_verifier, function(error, accessToken, accessTokenSecret, results) {

		if (error) {
			logger.error(error);
			return;
		}

		oauth.post(hostTrelloAPI + "cards", accessToken, accessTokenSecret, card, function(error, data) {
			if (error) {
				logger.error(error);
			} else {
				logger.info('Cartão adicionado: ' + card.name);
			}
		});
	});
};

var isArray = function(objectJson) {
    return Object.prototype.toString.call(objectJson) === '[object Array]';
};

// ### Tratadores das requisições ###

app.use(function(error, req, res, next) {
	if (error) {
		logger.error(error);
	}
});

app.get('/', function(req, res) {

	if (oauth_token != null) {

		res.writeHead(301, {
	      'Location':  host + "/index.html"
	    });

	} else {

		res.writeHead(301, {
	      'Location':  host + "/login"
	    });		
	}

    return res.end();
});

app.get('/login', function(req, res) {

	return oauth.getOAuthRequestToken((function(_this) {

	  return function(error, token, tokenSecret, results) {
	  	
	  	if (error) {
			logger.error(error);
			return res.end();
		}

	    oauth_secrets[token] = tokenSecret;
	    res.writeHead(302, {
	      'Location': authorizeURL + "?oauth_token=" + token + "&name=" + appName + "&expiration=never&scope=read,write"
	    });

	    return res.end();
	  };

	})(this));

});

app.get('/afterLogin', function(req, res) {

	var query = url.parse(req.url, true).query;
	oauth_token = query.oauth_token;
	oauth_verifier = query.oauth_verifier;

	res.writeHead(301,
			{ Location : host + "/index.html"}
	);
	res.end();

});

app.get('/getBoards', function(req, res) {
	
	var tokenSecret = oauth_secrets[oauth_token];

	return oauth.getOAuthAccessToken(oauth_token, tokenSecret, oauth_verifier, function(error, accessToken, accessTokenSecret, results) {

		if (error) {
			logger.error(error);
			return res.end();
		}

		return oauth.getProtectedResource(hostTrelloAPI + "members/me/boards", "GET", accessToken, accessTokenSecret, function(error, data, response) {

			if (error) {
				logger.error(error);
				return res.end();
			}

	    	return res.end(data);
	  	});
	});

});

app.get('/getLists', function(req, res) {
	
	var tokenSecret = oauth_secrets[oauth_token];
	var query = url.parse(req.url, true).query;
	boardSync.boardId = query.boardId;

	return oauth.getOAuthAccessToken(oauth_token, tokenSecret, oauth_verifier, function(error, accessToken, accessTokenSecret, results) {

		if (error) {
			logger.error(error);
			return res.end();
		}

		return oauth.getProtectedResource(hostTrelloAPI + "boards/" + boardSync.boardId + "/lists", "GET", accessToken, accessTokenSecret, function(error, data, response) {

			if (error) {
				logger.error(error);
				return res.end();
			}

			return res.end(data);
		});
	});

});

app.get('/setEntryList', function(req, res) {
	
	var query = url.parse(req.url, true).query;
	boardSync.listId = query.listId;

	res.end();
});

app.get('/loadTasks', function(req, res) {

	var connection = new sql.Connection(databaseConfig, function(error) {
		
		if (error) {
			logger.error(error);
			res.status(500).send(error);
			return;
		}

		databaseTasks = [];

		var request = new sql.Request(connection); 

		request.query(queryTasks, function(error, recordset) {

			if (error !== undefined) {

				logger.error(error);

				res.status(500).send(error);

			} else {

				logger.info(recordset.length +  ' tarefas carregadas');

				for (var i = 0; i < recordset.length; i++) {
					databaseTasks.push(toTask(recordset[i]));
				}
				
				res.status(200).send();
			}
		});

	});

});

app.get('/loadTrelloCards', function(req, res) {

	var tokenSecret = oauth_secrets[oauth_token];

	return oauth.getOAuthAccessToken(oauth_token, tokenSecret, oauth_verifier, function(error, accessToken, accessTokenSecret, results) {

		if (error) {
			logger.error(error);
			return res.end();
		}

		return oauth.getProtectedResource(hostTrelloAPI + "boards/" + boardSync.boardId + "/cards?fields=name", "GET", accessToken, accessTokenSecret, function(error, data, response) {

			if (error) {
				logger.error(error);
				return res.end();
			}

			trelloCards = JSON.parse(data);	

			logger.info(trelloCards.length +  ' cartões do Trello carregados');

			return res.end();
	  });
	});

});

app.get('/syncronizeCards', function(req, res) {
	var cardsNotAdded = [];

	for (var i = 0; i < databaseTasks.length; i++) {

		var task = databaseTasks[i];
		var cardAdded = false;

		for (var j = 0; j < trelloCards.length; j++) {
			var card = trelloCards[j];
			if (card.name) {
				var cardNumbers = card.name.match(/\d+/);
				if (cardNumbers.length > 0) {
					var cardId = cardNumbers[0];
					if (cardId == task.id) {
						cardAdded = true;
						break;
					}	
				}
			}
		}

		if (cardAdded === false) {
			cardsNotAdded.push(toCard(task));
		}

	}

	logger.info(cardsNotAdded.length +  ' cartões que serão adicionados no Trello');

	for (var i = 0; i < cardsNotAdded.length; i++) {
		var card = cardsNotAdded[i];
		addTrelloCard(card);
	}

	if (cardsNotAdded.length == 0) {
		return res.end();
	}

	return res.end(JSON.stringify(cardsNotAdded));
});

// ### Inicia Servidor ###

app.listen(port);

logger.info("Server running at " + domain + ":" + port + "; hit " + domain + ":" + port + "/login");
logger.info('Configurações carregadas com sucesso do arquivo "configuration.properties"');