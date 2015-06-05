(function () {
    'use strict';

    if (typeof String.prototype.format !== 'function') {
        String.prototype.format = function() {
            var args = arguments;
            return this.replace(/{(\d+)}/g, function(match, number) { 
                return typeof args[number] != 'undefined' ? args[number] : match;
            });
        };
    }

    if (localStorage.getItem('tarefasHead') === null) {
        localStorage.setItem('tarefasHead', JSON.stringify({'lista': []}));
    }

    function addTarefaProntaHead() {
        var tarefas = JSON.parse(localStorage.getItem('tarefasHead')),
            tarefaId = document.querySelector('#tarefaId').value;

        tarefas.lista.push(tarefaId);

        localStorage.setItem('tarefasHead', JSON.stringify(tarefas));
    }

    function resetaListaTarfasHead() {
        if (confirm('Deseja realmente apagar a lista de tarefas prontas no HEAD?')) {
            localStorage.setItem('tarefasHead', JSON.stringify({'lista': []}));
        }
    }

    function toggleModalAddTarefa() {
        $('#tarefaId').val('');
        $('#addTarefaModal').modal('toggle');
    }

    function createNotification(tarefa) {
        var title = 'Nova tarefa {0}'.format(tarefa.prioridadeStr),
            message = '{0} - [{1}] {2}'.format(tarefa.id, tarefa.natureza, tarefa.titulo),
            icons = {
                'Alta': 'img_alta.png',
                'Média': 'img_media.png',
                'Baixa': 'img_baixa.png'
            },
            iconPath = 'images/';

        new Notification(title, {
            icon: iconPath + icons[tarefa.prioridadeStr],
            body: message
        });
    }

    function verifyForNotifications(tarefasOld, tarefasNew) {
        var achou = false, i, j;

        for (i = 0; i < tarefasNew.length; i += 1) {
            achou = false;

            for (j = 0; j < tarefasOld.length; j += 1) {
                if (tarefasNew[i].id === tarefasOld[j].id) {
                    achou = true;
                    break;
                }
            }

            if (!achou) {
                createNotification(tarefasNew[i]);
            }
        }
    }

    window.onload = function () {
        if (Notification.permission === 'default') {
            Notification.requestPermission();
        }

        $('#addTarefaModal').on('shown.bs.modal', function () {
            $('#tarefaId').focus();
        });

        var keyCodes = {
            'a': 97,
            'r': 114,
            'enter': 13
        };

        document.body.onkeypress =  function (event) {
            var keyCode = event.which || event.keyCode;

            if (keyCode === keyCodes.a) {
                toggleModalAddTarefa();
            } else if (keyCode === keyCodes.r) {
                resetaListaTarfasHead();
            }
        };

        document.querySelector('#tarefaId').onkeypress =  function (event) {
            var keyCode = event.which || event.keyCode;

            if (keyCode === keyCodes.enter) {
                addTarefaProntaHead();
                toggleModalAddTarefa();
            }
        };
    };

    var app = angular.module('dashboard', []);

    app.controller('DashboardController', ['$http', '$timeout', function ($http, $timeout) {
        var dashboard = this;

        dashboard.tarefas = [];
        dashboard.hasSearchError = false;
        dashboard.onlyClientTasks = false;
        dashboard.naturezas = [];
        dashboard.locations = [];
        dashboard.responsable = [];
        dashboard.paths = [];
        dashboard.naturezaClasses = {
            'Erro': 'glyphicon-warning-sign',
            'Documentação': 'glyphicon-book',
            'Dúvida': 'glyphicon-question-sign',
            'Repasse': 'glyphicon-transfer',
            'Implementação': 'glyphicon-wrench',
            'Serviço': 'glyphicon-cog'
        };

        function countNaturezas(tarefas) {
            var length = tarefas.length,
                naturezaTarefa = '',
                naturezas = {},
                i = 0,
                key;

            for (; i < length; i += 1) {
                naturezaTarefa = tarefas[i].natureza;

                if (naturezas.hasOwnProperty(naturezaTarefa)) {
                    naturezas[naturezaTarefa] += 1;
                } else {
                    naturezas[naturezaTarefa] = 1;
                }
            }

            dashboard.naturezas = [];

            for (key in naturezas) {
                dashboard.naturezas.push({'descricao': key, 'qtd': naturezas[key]});
            }
        }

        function getItensOfListProperty(propName) {
            var i = 0,
                propValue = '', 
                propList = [], 
                qtdTasks = dashboard.tarefas.length;
            
            for (; i < qtdTasks; i++) {
                propValue = dashboard.tarefas[i][propName];

                if (propList.indexOf(propValue) === -1) {
                    propList.push(propValue);
                }
            }

            return propList.sort();
        }

        function getAjax() {
            $http.get('http://teste35:3010/tarefas/portal')
	            .success(function (data) {
	                if (dashboard.tarefas.length > 0) {
	                    if (Notification.permission === 'granted') {
                            verifyForNotifications(dashboard.tarefas, data);    
                        }                        
	                }

	                countNaturezas(data);

	                dashboard.tarefas = data;
	                dashboard.hasSearchError = false;

                    //console.log(getItensOfListProperty('localizacao'));
	            })
	            .error(function (data) {
	                dashboard.hasSearchError = true;
	                console.log(data);
            });

            $timeout(getAjax, 2 * 60 * 1000);
        }

        getAjax();

        this.getDataVencimentoOuIdade =  function (tarefa) {
            if (tarefa.hasCliente === 1) {
                if (tarefa.vencimento === null) {
                    return tarefa.idadeChamado;
                }

                return '{0} | {1}'.format(tarefa.vencimento, tarefa.idadeChamado);
            }

            return tarefa.idadeTarefa;
        };

        this.getNomeClienteSemCodigo =  function (nomeCliente) {
            if (nomeCliente !== null) {
                return nomeCliente.replace(/\s\/.+?\//, '');
            }

            return '';
        };

        this.getNaturezaClass =  function (natureza) {
            return dashboard.naturezaClasses[natureza];
        };

        this.isTarefaCorrigidaHead =  function (codigo) {
            var tarefas = JSON.parse(localStorage.getItem('tarefasHead')),
                qtdTarefas = tarefas.lista.length,
                i;

            for (i = 0; i < qtdTarefas; i += 1) {
                if (parseInt(tarefas.lista[i]) === codigo) {
                    return true;
                }
            }

            return false;
        };

        this.getNomeProdutoResumido = function(codigoProduto) {
            switch (codigoProduto) {
                case 72:
                    return 'PC';
                case 7:
                    return 'TEC';
            }
        }
    }]);
}());