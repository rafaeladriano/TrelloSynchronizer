(function () {
    'use strict';

    var app = angular.module('trelloSynchronizer', []);

    app.controller('TrelloSynchronizerController', ['$http', function ($http, $timeout) {
        var dashboard = this;

        dashboard.trelloBoards = [];

        function loadBoards() {

            if (dashboard.trelloBoards.length == 0) {
                $http.get('/getBoards')
    	            .success(function (data) {
    	                dashboard.trelloBoards = data;
    	            })
    	            .error(function (data) {
    	                console.log(data);
                });

            }
            
        };

        dashboard.login = function(board) {
            $http.get('/login/?filename=' + board.filename)
                .success(function (data) {
                    dashboard.trelloBoardLists = data;
                })
                .error(function (data) {
                    console.log(data);
            });

        };

        loadBoards();

    }]);
}());