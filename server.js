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
var iconv = require('iconv-lite');

// ### Propriedades do Servidor ###

var domain = null;
var port = null;
var host = null;

var app = express();

// ### Propriedades do Trello ###

var appName = "Trello Synchronizer";
var requestURL = "https://trello.com/1/OAuthGetRequestToken";
var accessURL = "https://trello.com/1/OAuthGetAccessToken";
var authorizeURL = "https://trello.com/1/OAuthAuthorizeToken";
var hostTrelloAPI = "https://api.trello.com/1";

var key = null;
var secret = null;

// ### Propriedades do Banco de Dados ###

var databaseConfig = {
    user: null,
    password: null,
    server: null,
    database: null
};

// ### Estruturas de Dados ###

var labelsPriority = ["blue", "blue", "orange", "red"];

var boards = {};

// ### Configurações ###

var properties = null;
var logger = null;

// Inicializações necessárias

process.on('uncaughtException', function(err) {
  console.log('Caught exception: ' + err);
});

logger = log4js.getLogger();
log4js.configure('log_configuration.json', { reloadSecs: 300 });

properties = propertiesReader(__dirname + '/configuration.properties');

databaseConfig.user = properties.get('com.synchronizer.database.user');
databaseConfig.password = properties.get('com.synchronizer.database.password');
databaseConfig.server = properties.get('com.synchronizer.database.host');
databaseConfig.database = properties.get('com.synchronizer.database.databaseName');

key = properties.get('com.synchronizer.trello.key');
secret = properties.get('com.synchronizer.trello.secret');

domain = properties.get('com.synchronizer.server.domain');
port = properties.get('com.synchronizer.server.port');
host = "http://" + domain + ":" + port;

oauth = new OAuth(requestURL, accessURL, key, secret, "1.0", host + "/afterLogin", "HMAC-SHA1");

app.use(serveStatic(__dirname + '/public_html', {'index': ['index.html']}));

// ### Tratadores das requisições ###

app.use(function(error, req, res, next) {
	if (error) {
		logger.error(error);
	}
});

app.get('/', function(req, res) {

	res.writeHead(301, {
      'Location':  host + "/index.html"
    });

    return res.end();
});

app.get('/login', function(req, res) {

	return oauth.getOAuthRequestToken((function(_this) {

	  return function(error, token, tokenSecret, results) {
	  	
	  	if (error) {
			logger.error(error);
			return res.end();
		}

		var query = url.parse(req.url, true).query;

		if (!query.filename) {
			return res.end("Parameter 'filename' in url wasn't defined");
		}
		
		var board = boards[query.filename];
	    board.oauthInfo.secret = tokenSecret;
	    board.oauthInfo.token = token;

	    res.writeHead(302, {
	     	'Location': authorizeURL + "?oauth_token=" + token + "&name=" + appName + "&expiration=never&scope=read,write"
	    });

	    return res.end();
	  };

	})(this));

});

app.get('/afterLogin', function(req, res) {

	var query = url.parse(req.url, true).query;
	var board = null;
	for (var filename in boards) {
		var board = boards[filename];
		if (board.oauthInfo.token == query.oauth_token) {
			board.oauthInfo.verifier = query.oauth_verifier;
			break;
		}
	}

	res.writeHead(301,
		{ Location : host + "/index.html"}
	);

	res.end();

});

app.get('/getBoards', function(req, res) {

	var retBoards = [];

	for (var filename in boards) {
		var board = boards[filename];
		var logged = board.oauthInfo.token ? '[Synchronizing] - ' : ' [Not Synchronizing] - ';
		retBoards.push({
			name : logged + board.content.boardName,
			filename : filename
		});
	}

	res.end(JSON.stringify(retBoards));

});

// ### Funções ###

String.prototype.format = function () {
    var args = arguments;
    return this.replace(/{(.+?)}/g, function(match, number) { 
        return args[0].toString()==='[object Object]' ? args[0][number] : args[number];
    });
};

function synchronize() {

	logger.info('Synchronizing boards');

	var callbackSync = function() {

		// Carrega as tarefas da query
		loadTasks(board, function() {
			
			// Carrega os cartões do quadro
			loadTrelloCards(board, function() {

				// Sincroniza cartões
				synchronizeBoard(board);
			});
		});
	};

	for (var filename in boards) {

		var board = boards[filename];

		// Se estiver logado
		if (board.oauthInfo.token && board.oauthInfo.verifier) {
		
			// Carrega o quadro do Trello, caso ainda não tenha carregado
			loadTrelloBoard(board, function() {

				// Carrega as listas do Trello, caso ainda não tenha carregado
				loadTrelloLists(board, function() {

					// Carrega os usuários do Trello, caso ainda não tenha carregado
					loadTrelloMembers(board, callbackSync);		
				});	
			});

			if (board.membersTo != null) {
				callbackSync();
			}

		}

	}

}

function loadBoardsConfiguration() {
	var files = fileSystem.readdirSync(__dirname + '/boards');
	var fileSplitted = [];
	var content = '';

	logger.info('Loading boards information');

	for (var i = 0; i < files.length; i++) {
		fileSplitted = files[i].split('.');

		if (fileSplitted[fileSplitted.length - 1] === 'json') {
			logger.info('[{0}] Loading information'.format(fileSplitted[0]));

			content = fileSystem.readFileSync(__dirname + '/boards/' + files[i]);
			//content = iconv.decode(content, 'win1252');

			content = JSON.parse(content);
			
			addBoard(fileSplitted[0], content);
		}
	}

	for (var i = 0; i < files.length; i++) {
		fileSplitted = files[i].split('.');

		if (fileSplitted[fileSplitted.length - 1] === 'sql') {
			logger.info('[{0}] Loading query sql'.format(fileSplitted[0]));

			content = fileSystem.readFileSync(__dirname + '/boards/' + files[i]);
			content = iconv.decode(content, 'utf8');

			boards[fileSplitted[0]].queryTasks = content;
		}
	}

	logger.info('Boards information loaded');
}

function loadTrelloBoard(board, callback) {

	if (board.boardId != null) {
		return;
	}

	logger.info('[{0}] Loading Trello board'.format(board.content.boardName));
	
	oauth.getOAuthAccessToken(board.oauthInfo.token, board.oauthInfo.secret, board.oauthInfo.verifier, function(error, accessToken, accessTokenSecret, results) {

		if (error) {
			logger.error(error);
			return;
		}

		oauth.getProtectedResource(hostTrelloAPI + "/members/me/boards?fields=name&filter=open", "GET", accessToken, accessTokenSecret, function(error, data, response) {

			if (error) {
				logger.error(error);
				return;
			}

			var trelloBoards = JSON.parse(data);

			for (var i = 0; i < trelloBoards.length; i++) {
				if (trelloBoards[i].name == board.content.boardName) {
					board.boardId = trelloBoards[i].id;
					break;
				}
			}

			if (board.boardId == null) {
				logger.warn('[{0}] Board not found in logged user'.format(board.content.boardName));
			} else {
				callback();
			}

	    	return;
	  	});
	});

}

function loadTrelloLists(board, callback) {

	if (board.listsTo == null) {
		return;
	}

	logger.info('[{0}] Loading Trello lists'.format(board.content.boardName));
	logger.info('[{0}] Loading Trello lists'.format(board.boardId));

	oauth.getOAuthAccessToken(board.oauthInfo.token, board.oauthInfo.secret, board.oauthInfo.verifier, function(error, accessToken, accessTokenSecret, results) {

		if (error) {
			logger.error(error);
			return;
		}

		oauth.getProtectedResource(hostTrelloAPI + "/boards/" + board.boardId + "/lists?fields=name&filter=open", "GET", accessToken, accessTokenSecret, function(error, data, response) {

			if (error) {
				logger.error(error);
				return;
			}

			var trelloLists = JSON.parse(data);

			logger.log(trelloLists);

			var indexLocationName = 0;
			var indexListName = 1;

			for (var i = 0; i < board.content.locationsToLists.length; i++) {

				var locationName = board.content.locationsToLists[i][indexLocationName];
				var listName = board.content.locationsToLists[i][indexListName];

				for (var j = 0; j < trelloLists.length; j++) {
					if (trelloLists[j].name == listName) {
						board.listsTo[locationName] = trelloLists[j].id;
						break;
					}
				}

				if (!board.listsTo[locationName]) {
					logger.warn('[{1}] List {0} not found'.format(listName, board.content.boardName));
				} else {
					callback();
				}

			}

			return;
		});
	});

}

function loadTrelloMembers(board, callback) {

	if (board.membersTo == null) {
		return;
	}

	logger.info('[{0}] Loading Trello members'.format(board.content.boardName));

	oauth.getOAuthAccessToken(board.oauthInfo.token, board.oauthInfo.secret, board.oauthInfo.verifier, function(error, accessToken, accessTokenSecret, results) {

		if (error) {
			logger.error(error);
			return;
		}

		oauth.getProtectedResource(hostTrelloAPI + "/boards/" + board.boardId + "/members?fields=username", "GET", accessToken, accessTokenSecret, function(error, data, response) {

			if (error) {
				logger.error(error);
				return;
			}

			var trelloMembers = JSON.parse(data);

			var indexUserUsername = 0;
			var indexMemberUsername = 1;

			for (var i = 0; i < board.content.usersToMembers.length; i++) {

				var userUsername = board.content.usersToMembers[i][indexUserUsername];
				var memberUsername = board.content.usersToMembers[i][indexMemberUsername];

				for (var j = 0; j < trelloMembers.length; j++) {
					if (trelloMembers[j].username == memberUsername) {
						board.membersTo[userUsername] = trelloMembers[j].id;
						break;
					}
				}

				if (!board.membersTo[userUsername]) {
					logger.warn('[{1}] Trello member {0} not found'.format(memberUsername, board.content.boardName));
				} else {
					callback();
				}

			}

			return;
		});
	});

}

function loadTasks(board, callback) {

	var connection = new sql.Connection(databaseConfig, function(error) {
		
		if (error) {
			logger.error(error);
			return;
		}

		var databaseTasks = [];

		var request = new sql.Request(connection); 

		request.query(board.queryTasks, function(error, recordset) {

			if (error) {
				logger.error(error);
			} else {

				logger.info('[{1}] {0} loaded tasks'.format(recordset.length, board.content.boardName));

				for (var i = 0; i < recordset.length; i++) {
					databaseTasks.push(toTask(recordset[i]));
				}

				board.dataSync.tasks = databaseTasks;

				callback();
			}
		});

	});

}

function loadTrelloCards(board, callback) {

	oauth.getOAuthAccessToken(board.oauthInfo.token, board.oauthInfo.secret, board.oauthInfo.verifier, function(error, accessToken, accessTokenSecret, results) {

		if (error) {
			logger.error(error);
			return res.end();
		}

		oauth.getProtectedResource(hostTrelloAPI + "/boards/" + board.boardId + "/cards?fields=name", "GET", accessToken, accessTokenSecret, function(error, data, response) {

			if (error) {
				logger.error(error);
				return;
			}

			board.dataSync.cards = JSON.parse(data);

			logger.info('[{1}] {0} loaded cards'.format(board.dataSync.cards.length, board.content.boardName));

			callback();
	  });
	});

}

function synchronizeBoard(board) {

	logger.info('[{0}] Synchronizing board'.format(board.content.boardName));

	var cardsNotAdded = []; // Cartões que serão adicionados
	var cardsClosed = []; // Cartões que serão fechados

	// Adicionando cartões

	for (var i = 0; i < board.dataSync.tasks.length; i++) {

		var task = board.dataSync.tasks[i];
		var cardAdded = false;

		for (var j = 0; j < trelloCards.length; j++) {
			var card = trelloCards[j];
			if (card.name) {
				var cardNumbers = card.name.match(/\d+/);

				if (!isArray(cardNumbers)) {
					var cardNumber = cardNumbers;
					cardNumbers = [];
					cardNumbers.push(cardNumber);
				}

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
			cardsNotAdded.push(toCard(board.listsTo['Manutenção'], task)); // TODO fazer o de para da listas
		}

	}

	logger.info('[{0}] {1} cards to open'.format(board.content.boardName, cardsNotAdded.length));

	for (var i = 0; i < cardsNotAdded.length; i++) {
		var card = cardsNotAdded[i];
		openTrelloCard(board, card);
	}

	// Fechando cartões

	for (var i = 0; i < board.dataSync.cards.length; i++) {

		var card = board.dataSync.cards[i];

		if (card.name) {
			var cardNumbers = card.name.match(/\d+/);

			if (!isArray(cardNumbers)) {
				var cardNumber = cardNumbers;
				cardNumbers = [];
				cardNumbers.push(cardNumber);
			}

			if (cardNumbers.length > 0) {
				var cardId = cardNumbers[0];

				if (cardId != null) {

					var taskClosed = false;

					for (var j = 0; j < databaseTasks.length; j++) {
						var task = databaseTasks[j];
						
						if (cardId == task.id) {
							taskClosed = true;
							break;
						}
					}

					if (taskClosed === false) {
						cardsClosed.push(toCardForClose(card));
					}

				}
				
			}
		}

	}

	logger.info('[{0}] {1} cards to close'.format(board.content.boardName, cardsClosed.length));
	for (var i = 0; i < cardsClosed.length; i++) {
		var card = cardsClosed[i];
		closeTrelloCard(board, card);
	}

}

function addBoard(fileName, content) {

	var board = {
		boardId : null,
		oauthInfo : {
			token : null,
			verifier : null,
			secret : null
		},
		listsTo : {},
		membersTo : {},
		content : content,
		dataSync : {
			tasks : null,
			cards : null
		},
		queryTasks : null
	};

	boards[fileName] = board;
}

function toTask(record) {
	return {
		id : record.id,
		title : record.title,
		priority : record.priority,
		hasClient : record.hasClient,
		due : record.due
	};
}

function toCard(task) {

	var labelsAux = [];
	labelsAux.push(labelsPriority[task.priority]);

	return {
		name : task.id + ' - ' + task.title,
		due : task.due,
		labels :  labelsAux,
		idList : boardSync.listId,
		urlSource : null
	};
}

function toCardForClose(card) {
	return {
		id : card.id,
		title : card.name
	};
}

function openTrelloCard(board, card) {
	oauth.getOAuthAccessToken(board.oauthInfo.token, board.oauthInfo.secret, board.oauthInfo.verifier, function(error, accessToken, accessTokenSecret, results) {

		if (error) {
			logger.error(error);
			return;
		}

		oauth.post(hostTrelloAPI + "/cards", accessToken, accessTokenSecret, card, function(error, data) {
			if (error) {
				logger.error(error);
			} else {
				logger.info('[{0}] Opened card: {1}'.format(board.content.boardName, card.name));

/*				if (hasClient) {
					oauth.put(hostTrelloAPI + "/cards", accessToken, accessTokenSecret, card, function(error, data) {
						if (error) {
							logger.error(error);
						} else {
							logger.info('Adicionado sticker no cartão(cliente): ' + card.name);
						}
					}
				}
*/
			}
		});
	});
}

function closeTrelloCard(board, card) {
	oauth.getOAuthAccessToken(board.oauthInfo.token, board.oauthInfo.secret, board.oauthInfo.verifier, function(error, accessToken, accessTokenSecret, results) {

		if (error) {
			logger.error(error);
			return;
		}

		oauth.put(hostTrelloAPI + "/cards/" + card.id + "/closed", accessToken, accessTokenSecret, { value : true }, function(error, data) {
			if (error) {
				logger.error(error);
			} else {
				logger.info('[{0}] Closed card: {1}'.format(board.content.boardName, card.title));
			}
		});
	});
}

function isArray(objectJson) {
    return Object.prototype.toString.call(objectJson) === '[object Array]';
}

// ### Repete a busca dos dados no banco a cada 5 minutos ###
setInterval(function() {
	synchronize();
}, 1 * 30 * 1000);


fileSystem.exists(__dirname + '/boards', function(exists) {
	if (!exists) {
		logger.warn('boards folder not found');
		return;
	}

	loadBoardsConfiguration();

	// ### Inicia Servidor ###

	app.listen(port);

	logger.info("Server running at " + host + "; hit " + host + "/login?filename=<filename in boards folder>");
});