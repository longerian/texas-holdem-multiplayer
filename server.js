const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 静态文件
app.use(express.static(path.join(__dirname, 'public')));

// 房间管理
const rooms = new Map();

// 生成房间码
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// 游戏状态
function createGameState() {
  return {
    deck: [],
    communityCards: [],
    pot: 0,
    currentBet: 0,
    phase: 'waiting', // waiting, preflop, flop, turn, river, showdown
    currentPlayerIndex: 0,
    gameActive: false,
    smallBlind: 5,
    bigBlind: 10,
    dealerIndex: 0,
    players: [],
    actedThisRound: [],
    lastRaisePlayerIndex: -1
  };
}

// 创建牌组
function createDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const deck = [];
  for (let suit of suits) {
    for (let rank of ranks) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

// 洗牌
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// 获取房间信息
function getRoomInfo(room) {
  return {
    code: room.code,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      chips: p.chips,
      ready: p.ready,
      isHost: p.isHost
    })),
    maxPlayers: room.maxPlayers,
    gameActive: room.gameState.gameActive
  };
}

// 广播房间状态
function broadcastRoomState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  
  const roomInfo = getRoomInfo(room);
  io.to(roomCode).emit('roomUpdate', roomInfo);
}

// 广播游戏状态
function broadcastGameState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  
  const gs = room.gameState;
  
  // 为每个玩家发送只属于自己的手牌
  room.players.forEach(player => {
    const playerGameState = {
      ...gs,
      players: gs.players.map(p => {
        // 只显示自己的手牌，其他玩家的牌隐藏（除了摊牌阶段）
        if (p.id === player.id || gs.phase === 'showdown') {
          return p;
        }
        return {
          ...p,
          hand: p.hand.length > 0 ? [{ hidden: true }, { hidden: true }] : []
        };
      })
    };
    io.to(player.id).emit('gameState', playerGameState);
  });
}

// 开始游戏
function startGame(room) {
  const gs = room.gameState;
  
  // 初始化玩家状态
  gs.players = room.players.map((p, index) => ({
    id: p.id,
    name: p.name,
    chips: p.chips,
    hand: [],
    bet: 0,
    folded: false,
    isAllIn: false,
    index
  }));
  
  // 发牌
  gs.deck = shuffle(createDeck());
  gs.communityCards = [];
  gs.pot = 0;
  gs.currentBet = gs.bigBlind;
  gs.phase = 'preflop';
  gs.gameActive = true;
  gs.actedThisRound = [];
  gs.dealerIndex = (gs.dealerIndex + 1) % gs.players.length;
  
  // 发手牌
  gs.players.forEach(player => {
    if (!player.folded) {
      player.hand = [gs.deck.pop(), gs.deck.pop()];
    }
  });
  
  // 设置盲注
  const smallBlindIndex = (gs.dealerIndex + 1) % gs.players.length;
  const bigBlindIndex = (gs.dealerIndex + 2) % gs.players.length;
  
  const smallBlindPlayer = gs.players[smallBlindIndex];
  const bigBlindPlayer = gs.players[bigBlindIndex];
  
  const actualSmallBlind = Math.min(gs.smallBlind, smallBlindPlayer.chips);
  const actualBigBlind = Math.min(gs.bigBlind, bigBlindPlayer.chips);
  
  smallBlindPlayer.chips -= actualSmallBlind;
  smallBlindPlayer.bet = actualSmallBlind;
  if (smallBlindPlayer.chips === 0) smallBlindPlayer.isAllIn = true;
  
  bigBlindPlayer.chips -= actualBigBlind;
  bigBlindPlayer.bet = actualBigBlind;
  if (bigBlindPlayer.chips === 0) bigBlindPlayer.isAllIn = true;
  
  gs.pot = actualSmallBlind + actualBigBlind;
  gs.currentBet = actualBigBlind;
  
  // 从大盲后开始
  gs.currentPlayerIndex = (bigBlindIndex + 1) % gs.players.length;
  
  broadcastGameState(room.code);
}

// Socket.IO 连接处理
io.on('connection', (socket) => {
  console.log(`玩家连接: ${socket.id}`);
  
  // 创建房间
  socket.on('createRoom', (data) => {
    const roomCode = generateRoomCode();
    const room = {
      code: roomCode,
      players: [],
      maxPlayers: 6,
      gameState: createGameState()
    };
    
    rooms.set(roomCode, room);
    
    socket.join(roomCode);
    
    const player = {
      id: socket.id,
      name: data.name || '玩家1',
      chips: 1000,
      ready: false,
      isHost: true
    };
    
    room.players.push(player);
    
    socket.emit('roomCreated', { roomCode, playerId: socket.id });
    broadcastRoomState(roomCode);
    
    console.log(`房间创建: ${roomCode}`);
  });
  
  // 加入房间
  socket.on('joinRoom', (data) => {
    const room = rooms.get(data.roomCode);
    
    if (!room) {
      socket.emit('error', { message: '房间不存在' });
      return;
    }
    
    if (room.players.length >= room.maxPlayers) {
      socket.emit('error', { message: '房间已满' });
      return;
    }
    
    if (room.gameState.gameActive) {
      socket.emit('error', { message: '游戏进行中，无法加入' });
      return;
    }
    
    socket.join(data.roomCode);
    
    const player = {
      id: socket.id,
      name: data.name || `玩家${room.players.length + 1}`,
      chips: 1000,
      ready: false,
      isHost: false
    };
    
    room.players.push(player);
    
    socket.emit('roomJoined', { roomCode: data.roomCode, playerId: socket.id });
    broadcastRoomState(data.roomCode);
    
    console.log(`玩家加入房间: ${data.roomCode}`);
  });
  
  // 准备
  socket.on('ready', (data) => {
    const room = rooms.get(data.roomCode);
    if (!room) return;
    
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.ready = !player.ready;
      broadcastRoomState(data.roomCode);
    }
  });
  
  // 开始游戏（仅房主）
  socket.on('startGame', (data) => {
    const room = rooms.get(data.roomCode);
    if (!room) return;
    
    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.isHost) return;
    
    if (room.players.length < 2) {
      socket.emit('error', { message: '至少需要2名玩家' });
      return;
    }
    
    startGame(room);
    console.log(`游戏开始: ${data.roomCode}`);
  });
  
  // 玩家行动
  socket.on('playerAction', (data) => {
    const room = rooms.get(data.roomCode);
    if (!room) return;
    
    const gs = room.gameState;
    if (!gs.gameActive) return;
    
    const playerIndex = gs.players.findIndex(p => p.id === socket.id);
    if (playerIndex === -1) return;
    if (gs.currentPlayerIndex !== playerIndex) return;
    
    const player = gs.players[playerIndex];
    const action = data.action;
    const amount = data.amount || 0;
    
    // 处理行动
    switch (action) {
      case 'fold':
        player.folded = true;
        break;
        
      case 'check':
        // 无需支付
        break;
        
      case 'call':
        const toCall = gs.currentBet - player.bet;
        if (toCall >= player.chips) {
          // All in
          gs.pot += player.chips;
          player.bet += player.chips;
          player.chips = 0;
          player.isAllIn = true;
        } else {
          player.chips -= toCall;
          player.bet = gs.currentBet;
          gs.pot += toCall;
        }
        break;
        
      case 'raise':
        const raiseAmount = Math.min(amount, player.chips + player.bet);
        const toCallNew = raiseAmount - player.bet;
        
        if (toCallNew >= player.chips) {
          // All in
          gs.pot += player.chips;
          player.bet += player.chips;
          player.chips = 0;
          player.isAllIn = true;
        } else {
          player.chips -= toCallNew;
          player.bet = raiseAmount;
          gs.currentBet = raiseAmount;
          gs.pot += toCallNew;
          gs.actedThisRound = [playerIndex];
        }
        break;
    }
    
    // 记录已行动
    if (!gs.actedThisRound.includes(playerIndex)) {
      gs.actedThisRound.push(playerIndex);
    }
    
    // 下一个玩家或下一阶段
    nextPlayer(room);
    
    broadcastGameState(room.code);
  });
  
  // 离开房间
  socket.on('disconnect', () => {
    console.log(`玩家断开: ${socket.id}`);
    
    // 从所有房间中移除
    rooms.forEach((room, roomCode) => {
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        
        if (room.players.length === 0) {
          rooms.delete(roomCode);
          console.log(`房间删除: ${roomCode}`);
        } else {
          // 转移房主
          if (!room.players.some(p => p.isHost)) {
            room.players[0].isHost = true;
          }
          broadcastRoomState(roomCode);
        }
      }
    });
  });
});

// 下一个玩家或进入下一阶段
function nextPlayer(room) {
  const gs = room.gameState;
  
  // 检查是否只剩一个玩家
  const activePlayers = gs.players.filter(p => !p.folded);
  if (activePlayers.length === 1) {
    endRound(room, activePlayers[0]);
    return;
  }
  
  // 找下一个需要行动的玩家
  let nextIndex = (gs.currentPlayerIndex + 1) % gs.players.length;
  let attempts = 0;
  
  while (attempts < gs.players.length) {
    const nextPlayer = gs.players[nextIndex];
    
    if (!nextPlayer.folded && !nextPlayer.isAllIn && nextPlayer.chips > 0) {
      // 检查是否需要行动
      const needsToAct = !gs.actedThisRound.includes(nextIndex) || 
                         (gs.currentBet > nextPlayer.bet);
      
      if (needsToAct) {
        gs.currentPlayerIndex = nextIndex;
        return;
      }
    }
    
    nextIndex = (nextIndex + 1) % gs.players.length;
    attempts++;
  }
  
  // 所有人都行动过了，进入下一阶段
  nextPhase(room);
}

// 进入下一阶段
function nextPhase(room) {
  const gs = room.gameState;
  
  // 重置本轮状态
  gs.players.forEach(p => p.bet = 0);
  gs.currentBet = 0;
  gs.actedThisRound = [];
  
  switch (gs.phase) {
    case 'preflop':
      gs.phase = 'flop';
      gs.communityCards = [
        gs.deck.pop(),
        gs.deck.pop(),
        gs.deck.pop()
      ];
      break;
    case 'flop':
      gs.phase = 'turn';
      gs.communityCards.push(gs.deck.pop());
      break;
    case 'turn':
      gs.phase = 'river';
      gs.communityCards.push(gs.deck.pop());
      break;
    case 'river':
      showdown(room);
      return;
  }
  
  // 从庄家后第一个活跃玩家开始
  let startIndex = (gs.dealerIndex + 1) % gs.players.length;
  for (let i = 0; i < gs.players.length; i++) {
    const player = gs.players[startIndex];
    if (!player.folded && !player.isAllIn && player.chips > 0) {
      gs.currentPlayerIndex = startIndex;
      break;
    }
    startIndex = (startIndex + 1) % gs.players.length;
  }
}

// 摊牌
function showdown(room) {
  const gs = room.gameState;
  gs.phase = 'showdown';
  
  const activePlayers = gs.players.filter(p => !p.folded);
  
  // 简单版：随机选择赢家（后续可以加入牌力比较）
  const winner = activePlayers[Math.floor(Math.random() * activePlayers.length)];
  winner.chips += gs.pot;
  
  // 3秒后可以开始新一局
  setTimeout(() => {
    gs.gameActive = false;
    gs.phase = 'waiting';
    broadcastGameState(room.code);
  }, 3000);
}

// 结束一轮
function endRound(room, winner) {
  const gs = room.gameState;
  gs.phase = 'showdown';
  winner.chips += gs.pot;
  
  setTimeout(() => {
    gs.gameActive = false;
    gs.phase = 'waiting';
    broadcastGameState(room.code);
  }, 3000);
}

// 启动服务器
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`德州扑克多人版服务器运行在 http://localhost:${PORT}`);
});
