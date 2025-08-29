const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

// Inicializar aplicação Express
const app = express();
const server = http.createServer(app);

// Configurar Socket.IO com CORS otimizado
const io = socketIo(server, {
  cors: {
    origin: [
      "http://localhost:19006",     // Expo local
      "https://expo.dev",           // Expo online
      "exp://192.168.*.*:19000",    // Expo LAN
      "exp://192.168.*.*:8081",     // Expo Metro
      "*"                           // Permitir todos para produção
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"]
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

// Middleware básico
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Servir arquivos estáticos (se houver)
app.use(express.static('public'));

// ===================== DADOS GLOBAIS DO SISTEMA =====================

let connectedUsers = {
  surdos: {},
  interpretes: {},
  empresas: {}
};

let callQueue = [];
let systemStats = {
  totalCalls: 0,
  activeCalls: 0,
  totalUsers: 0,
  uptime: new Date(),
  totalConnections: 0,
  successfulCalls: 0,
  rejectedCalls: 0
};

// ===================== ROTAS DA API REST =====================

// Rota principal - Status geral
app.get('/', (req, res) => {
  const currentTime = new Date();
  const uptimeMinutes = Math.round((currentTime - systemStats.uptime) / 1000 / 60);

  res.json({
    message: '🚀 Servidor Viva Libras Online!',
    status: 'Operacional',
    version: '2.0.0',
    description: 'Sistema de chamadas em tempo real para interpretação em Libras',
    timestamp: currentTime.toISOString(),
    stats: {
      uptime: uptimeMinutes + ' minutos',
      totalCalls: systemStats.totalCalls,
      activeCalls: callQueue.length,
      successfulCalls: systemStats.successfulCalls,
      rejectedCalls: systemStats.rejectedCalls,
      totalConnections: systemStats.totalConnections,
      connectedUsers: {
        surdos: Object.keys(connectedUsers.surdos).length,
        interpretes: Object.keys(connectedUsers.interpretes).length,
        empresas: Object.keys(connectedUsers.empresas).length,
        total: Object.keys(connectedUsers.surdos).length + 
               Object.keys(connectedUsers.interpretes).length +
               Object.keys(connectedUsers.empresas).length
      }
    },
    server: {
      platform: process.platform,
      nodeVersion: process.version,
      memoryUsage: process.memoryUsage(),
      pid: process.pid
    }
  });
});

// Status detalhado da API
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    connectedUsers: {
      surdos: Object.keys(connectedUsers.surdos).length,
      interpretes: Object.keys(connectedUsers.interpretes).length,
      empresas: Object.keys(connectedUsers.empresas).length,
      total: Object.keys(connectedUsers.surdos).length + 
             Object.keys(connectedUsers.interpretes).length +
             Object.keys(connectedUsers.empresas).length
    },
    activeCalls: callQueue.length,
    totalCalls: systemStats.totalCalls,
    successfulCalls: systemStats.successfulCalls,
    rejectedCalls: systemStats.rejectedCalls,
    uptime: systemStats.uptime,
    server: 'Viva Libras Production v2.0.0',
    health: 'OK'
  });
});

// Teste de conectividade
app.get('/api/test', (req, res) => {
  res.json({
    message: '✅ Servidor funcionando perfeitamente!',
    timestamp: new Date().toISOString(),
    success: true,
    latency: Date.now() - req.timestamp,
    version: '2.0.0'
  });
});

// Estatísticas em tempo real
app.get('/api/stats', (req, res) => {
  res.json({
    realTimeStats: {
      ...systemStats,
      currentTime: new Date().toISOString(),
      connectedUsers: {
        surdos: Object.keys(connectedUsers.surdos).length,
        interpretes: Object.keys(connectedUsers.interpretes).length,
        empresas: Object.keys(connectedUsers.empresas).length
      },
      activeCalls: callQueue.length,
      queueDetails: callQueue.map(call => ({
        id: call.id,
        caller: call.caller?.nome || 'Anônimo',
        status: call.status,
        timestamp: call.timestamp
      }))
    }
  });
});

// Lista de intérpretes disponíveis
app.get('/api/interpreters', (req, res) => {
  const availableInterpreters = Object.values(connectedUsers.interpretes)
    .filter(interpreter => interpreter.status === 'online')
    .map(interpreter => ({
      id: interpreter.id,
      nome: interpreter.nome,
      status: interpreter.status,
      lastActivity: interpreter.lastActivity
    }));

  res.json({
    available: availableInterpreters.length,
    interpreters: availableInterpreters,
    total: Object.keys(connectedUsers.interpretes).length
  });
});

// ===================== SOCKET.IO - COMUNICAÇÃO TEMPO REAL =====================

io.on('connection', (socket) => {
  console.log(\`📱 Nova conexão: \${socket.id} - \${new Date().toLocaleString('pt-BR')}\`);
  systemStats.totalConnections++;

  // Enviar status inicial para o cliente
  socket.emit('server_status', {
    message: '✅ Conectado ao servidor Viva Libras',
    connectedUsers: Object.keys(connectedUsers.surdos).length + 
                   Object.keys(connectedUsers.interpretes).length +
                   Object.keys(connectedUsers.empresas).length,
    serverTime: new Date().toISOString(),
    version: '2.0.0'
  });

  // ===== REGISTRO DE USUÁRIOS =====
  socket.on('register_user', (data) => {
    const { type, nome, telefone, id } = data;
    console.log(\`👤 Registrando usuário: \${type} - \${nome || id}\`);

    const userData = {
      id: socket.id,
      nome: nome || \`Usuário_\${Date.now()}\`,
      telefone: telefone || 'Não informado',
      socketId: socket.id,
      registeredAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      type: type
    };

    // Categorizar usuário
    if (type === 'surdo' || type === 'empresa') {
      connectedUsers.surdos[socket.id] = userData;
    } else if (type === 'interprete') {
      connectedUsers.interpretes[socket.id] = {
        ...userData,
        status: 'offline',
        totalCalls: 0
      };
    }

    console.log(\`📊 Usuários conectados: \${Object.keys(connectedUsers.surdos).length} surdos, \${Object.keys(connectedUsers.interpretes).length} intérpretes\`);

    // Broadcast estatísticas atualizadas
    io.emit('stats_update', {
      connectedUsers: {
        surdos: Object.keys(connectedUsers.surdos).length,
        interpretes: Object.keys(connectedUsers.interpretes).length,
        empresas: Object.keys(connectedUsers.empresas).length
      },
      timestamp: new Date().toISOString()
    });
  });

  // ===== SOLICITAÇÃO DE CHAMADAS =====
  socket.on('request_call', (data) => {
    console.log('📞 Nova solicitação de chamada:', data.caller?.nome || 'Usuário anônimo');
    systemStats.totalCalls++;

    // Buscar intérprete disponível
    const availableInterpreters = Object.values(connectedUsers.interpretes)
      .filter(interpreter => interpreter.status === 'online');

    if (availableInterpreters.length > 0) {
      // Selecionar intérprete com menos chamadas (balanceamento)
      const selectedInterpreter = availableInterpreters.reduce((prev, current) => 
        (prev.totalCalls || 0) <= (current.totalCalls || 0) ? prev : current
      );

      const callData = {
        id: \`call_\${Date.now()}\`,
        caller: {
          ...data.caller,
          socketId: socket.id
        },
        interpreter: selectedInterpreter,
        timestamp: new Date().toISOString(),
        status: 'pending',
        timeout: Date.now() + 30000 // 30 segundos
      };

      console.log(\`🔄 Enviando chamada para intérprete: \${selectedInterpreter.nome}\`);

      // Enviar chamada para o intérprete selecionado
      io.to(selectedInterpreter.socketId).emit('incoming_call', callData);

      // Adicionar à fila de chamadas
      callQueue.push({
        ...callData,
        callerSocketId: socket.id,
        interpreterSocketId: selectedInterpreter.socketId
      });

      systemStats.activeCalls++;

      // Timeout automático para chamadas não atendidas
      setTimeout(() => {
        const existingCall = callQueue.find(c => c.id === callData.id);
        if (existingCall && existingCall.status === 'pending') {
          console.log(\`⏰ Timeout da chamada: \${callData.id}\`);

          // Notificar timeout
          io.to(socket.id).emit('call_timeout', {
            message: 'O intérprete não respondeu a tempo. Tente novamente.',
            callId: callData.id
          });

          // Remover da fila
          removeCallFromQueue(callData.id);
        }
      }, 30000);

    } else {
      console.log('❌ Nenhum intérprete disponível');

      socket.emit('no_interpreter_available', {
        message: 'Nenhum intérprete disponível no momento. Tente novamente em alguns instantes.',
        availableInterpreters: 0,
        totalInterpreters: Object.keys(connectedUsers.interpretes).length,
        onlineInterpreters: availableInterpreters.length,
        timestamp: new Date().toISOString()
      });
    }
  });

  // ===== ACEITAR CHAMADAS =====
  socket.on('accept_call', (data) => {
    console.log(\`✅ Chamada aceita: \${data.callId}\`);
    const callIndex = callQueue.findIndex(c => c.id === data.callId);

    if (callIndex !== -1) {
      const call = callQueue[callIndex];
      call.status = 'accepted';
      call.acceptedAt = new Date().toISOString();

      // Atualizar estatísticas do intérprete
      if (connectedUsers.interpretes[socket.id]) {
        connectedUsers.interpretes[socket.id].totalCalls = 
          (connectedUsers.interpretes[socket.id].totalCalls || 0) + 1;
      }

      // Notificar surdo da conexão bem-sucedida
      io.to(call.callerSocketId).emit('call_accepted', {
        interpreter: data.interpreter || call.interpreter,
        callId: data.callId,
        message: '✅ Conectado com intérprete! Iniciando videochamada...',
        timestamp: new Date().toISOString()
      });

      systemStats.successfulCalls++;
      console.log(\`🎉 Chamada \${data.callId} conectada com sucesso!\`);
    }
  });

  // ===== REJEITAR CHAMADAS =====
  socket.on('reject_call', (data) => {
    console.log(\`❌ Chamada rejeitada: \${data.callId}\`);
    const call = callQueue.find(c => c.id === data.callId);

    if (call) {
      // Notificar surdo da rejeição
      io.to(call.callerSocketId).emit('call_rejected', {
        message: 'Intérprete não está disponível. Procurando outro...',
        callId: data.callId,
        timestamp: new Date().toISOString()
      });

      systemStats.rejectedCalls++;
      removeCallFromQueue(data.callId);
    }
  });

  // ===== ATUALIZAR STATUS DO INTÉRPRETE =====
  socket.on('update_status', (data) => {
    if (connectedUsers.interpretes[socket.id]) {
      const oldStatus = connectedUsers.interpretes[socket.id].status;
      connectedUsers.interpretes[socket.id].status = data.status;
      connectedUsers.interpretes[socket.id].lastActivity = new Date().toISOString();

      console.log(\`🔄 Status do intérprete \${socket.id} atualizado: \${oldStatus} → \${data.status}\`);

      // Broadcast mudança de status
      io.emit('interpreter_status_update', {
        interpreterId: socket.id,
        status: data.status,
        availableInterpreters: Object.values(connectedUsers.interpretes)
          .filter(i => i.status === 'online').length,
        timestamp: new Date().toISOString()
      });
    }
  });

  // ===== FINALIZAR CHAMADAS =====
  socket.on('end_call', (data) => {
    console.log(\`🔚 Finalizando chamada do usuário: \${socket.id}\`);
    const callIndex = callQueue.findIndex(call => 
      call.callerSocketId === socket.id || call.interpreterSocketId === socket.id
    );

    if (callIndex !== -1) {
      const call = callQueue[callIndex];

      // Notificar ambas as partes
      io.to(call.callerSocketId).emit('call_ended', {
        message: 'Chamada finalizada. Obrigado por usar o Viva Libras!',
        duration: Date.now() - new Date(call.timestamp).getTime(),
        timestamp: new Date().toISOString()
      });

      io.to(call.interpreterSocketId).emit('call_ended', {
        message: 'Atendimento finalizado com sucesso.',
        timestamp: new Date().toISOString()
      });

      removeCallFromQueue(call.id);
    }
  });

  // ===== DESCONEXÃO =====
  socket.on('disconnect', (reason) => {
    console.log(\`📴 Usuário desconectado: \${socket.id} - Motivo: \${reason} - \${new Date().toLocaleString('pt-BR')}\`);

    // Limpar usuário das listas
    const wasInterpreter = !!connectedUsers.interpretes[socket.id];
    delete connectedUsers.surdos[socket.id];
    delete connectedUsers.interpretes[socket.id];
    delete connectedUsers.empresas[socket.id];

    // Finalizar chamadas ativas do usuário
    const activeCall = callQueue.find(call => 
      call.callerSocketId === socket.id || call.interpreterSocketId === socket.id
    );

    if (activeCall) {
      // Notificar a outra parte da desconexão
      const otherSocketId = activeCall.callerSocketId === socket.id 
        ? activeCall.interpreterSocketId 
        : activeCall.callerSocketId;

      io.to(otherSocketId).emit('call_ended', {
        message: 'A outra pessoa desconectou. Chamada finalizada.',
        reason: 'disconnect',
        timestamp: new Date().toISOString()
      });

      removeCallFromQueue(activeCall.id);
    }

    // Broadcast estatísticas atualizadas
    io.emit('stats_update', {
      connectedUsers: {
        surdos: Object.keys(connectedUsers.surdos).length,
        interpretes: Object.keys(connectedUsers.interpretes).length,
        empresas: Object.keys(connectedUsers.empresas).length
      },
      interpreterDisconnected: wasInterpreter,
      timestamp: new Date().toISOString()
    });
  });

  // ===== HEARTBEAT/PING =====
  socket.on('ping', (data) => {
    socket.emit('pong', {
      timestamp: new Date().toISOString(),
      serverTime: Date.now(),
      ...data
    });
  });
});

// ===================== FUNÇÕES AUXILIARES =====================

// Remover chamada da fila
function removeCallFromQueue(callId) {
  const index = callQueue.findIndex(c => c.id === callId);
  if (index !== -1) {
    callQueue.splice(index, 1);
    systemStats.activeCalls = Math.max(0, systemStats.activeCalls - 1);
    console.log(\`🗑️ Chamada \${callId} removida da fila\`);
  }
}

// Limpeza automática de dados antigos
function cleanupOldData() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  // Limpar chamadas antigas (mais de 1 hora)
  const oldCalls = callQueue.filter(call => 
    new Date(call.timestamp) < oneHourAgo
  );

  oldCalls.forEach(call => removeCallFromQueue(call.id));

  if (oldCalls.length > 0) {
    console.log(\`🧹 Limpeza automática: \${oldCalls.length} chamadas antigas removidas\`);
  }

  // Limpar usuários inativos (mais de 2 horas)
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

  Object.keys(connectedUsers.interpretes).forEach(socketId => {
    const interpreter = connectedUsers.interpretes[socketId];
    if (interpreter.lastActivity && new Date(interpreter.lastActivity) < twoHoursAgo) {
      delete connectedUsers.interpretes[socketId];
      console.log(\`🧹 Intérprete inativo removido: \${interpreter.nome}\`);
    }
  });
}

// Log de estatísticas periódico
function logStats() {
  const connectedCount = Object.keys(connectedUsers.surdos).length + 
                        Object.keys(connectedUsers.interpretes).length +
                        Object.keys(connectedUsers.empresas).length;

  console.log('📊 ===== ESTATÍSTICAS DO SERVIDOR =====');
  console.log(\`   👥 Usuários conectados: \${connectedCount}\`);
  console.log(\`   📞 Chamadas ativas: \${callQueue.length}\`);
  console.log(\`   📈 Total de chamadas: \${systemStats.totalCalls}\`);
  console.log(\`   ✅ Chamadas bem-sucedidas: \${systemStats.successfulCalls}\`);
  console.log(\`   ❌ Chamadas rejeitadas: \${systemStats.rejectedCalls}\`);
  console.log(\`   🔄 Total de conexões: \${systemStats.totalConnections}\`);
  console.log(\`   🕐 Uptime: \${Math.round((new Date() - systemStats.uptime) / 1000 / 60)} minutos\`);
  console.log(\`   💾 Memória: \${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB\`);
  console.log('📊 ====================================');
}

// ===================== AGENDAMENTOS E LIMPEZAS =====================

// Limpeza automática a cada 1 hora
setInterval(cleanupOldData, 60 * 60 * 1000);

// Log de estatísticas a cada 15 minutos
setInterval(logStats, 15 * 60 * 1000);

// Health check a cada 5 minutos
setInterval(() => {
  console.log(\`💓 Health check - \${new Date().toLocaleString('pt-BR')} - Sistema OK\`);
}, 5 * 60 * 1000);

// ===================== INICIALIZAÇÃO DO SERVIDOR =====================

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log('🚀 ==========================================');
  console.log(\`📡 Servidor Viva Libras Online na porta \${PORT}\`);
  console.log('📞 Sistema de chamadas em tempo real ativo');
  console.log('🌐 Pronto para receber conexões globais!');
  console.log(\`🕐 Iniciado em: \${new Date().toLocaleString('pt-BR')}\`);
  console.log(\`🏗️ Ambiente: \${process.env.NODE_ENV || 'development'}\`);
  console.log(\`🔧 Node.js: \${process.version}\`);
  console.log('🚀 ==========================================');
});

// ===================== TRATAMENTO DE ERROS =====================

process.on('uncaughtException', (error) => {
  console.error('❌ Erro não capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promise rejeitada:', reason);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('📴 Recebido SIGTERM, encerrando servidor...');
  server.close(() => {
    console.log('✅ Servidor encerrado com sucesso');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('📴 Recebido SIGINT, encerrando servidor...');
  server.close(() => {
    console.log('✅ Servidor encerrado com sucesso');
    process.exit(0);
  });
});