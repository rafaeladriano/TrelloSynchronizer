(function () {
    'use strict';

    var app = angular.module('trelloSynchronizer', []);

    app.controller('TrelloSynchronizerController', ['$http', '$timeout', function ($http, $timeout) {
        var dashboard = this;
        var currentTimeout;

        dashboard.trelloBoards = [];
        dashboard.trelloBoardLists = [];
        dashboard.addedCards = [];
        dashboard.listId = 0;

        function getAjax() {

            if (dashboard.trelloBoards.length == 0) {

                console.log('Carregando quadros do usuario');
                $http.get('/getBoards')
    	            .success(function (data) {
    	                dashboard.trelloBoards = data;
    	            })
    	            .error(function (data) {
    	                console.log(data);
                });

            } else if (dashboard.listId != 0) {

                console.log('Sincronizando cartões com as tarefas...');

                $http.get('/loadTasks')
                    .success(function (data) {

                        console.log('Carga das tarefas bem sucedida!');

                         $http.get('/loadTrelloCards')
                            .success(function (data) {
                                
                                console.log('Carga dos cartões do Trello bem sucedida!');

                                $http.get('/syncronizeCards')
                                    .success(function (data) {

                                        dashboard.addedCards = data;
                                        console.log('Sincronização bem sucedida!');

                                    })
                                    .error(function (data) {
                                        console.log(data);
                                });

                            })
                            .error(function (data) {
                                console.log(data);
                        });


                    })
                    .error(function (data) {
                        console.log(data);
                });

            } else {
                console.log('Esperando usuário escolher uma lista de entrada...');
            }
            
            if (currentTimeout) {
                $timeout.cancel(currentTimeout);
            }

            currentTimeout = $timeout(getAjax, 300 * 1000);

        };

        dashboard.getLists = function(board) {
            dashboard.listId = 0;
            console.log('Carregando listas do quadro: ' + board.id);
            $http.get('/getLists/?boardId=' + board.id)
                .success(function (data) {
                    dashboard.trelloBoardLists = data;
                })
                .error(function (data) {
                    console.log(data);
            });

        };

        dashboard.setEntryList = function(list) {
            console.log('Definindo lista de entrada para novos cartões: ' + list.id);
            $http.get('/setEntryList/?listId=' + list.id)
                .success(function (data) {
                    dashboard.listId = list.id;
                    getAjax();
                })
                .error(function (data) {
                    console.log(data);
            });
        };

        getAjax();

    }]);
}());