const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { aiDecision, recordPlayerAction, resetTracking, evaluateHand, getBestHandDescription } = require('./ai-engine');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,   // 60秒无响应才断开
  pingInterval: 25000   // 每25秒发送心跳
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
// 存储断开连接的玩家信息，用于重连
const disconnectedPlayers = new Map(); // oldSocketId -> { roomCode, seatIndex, name }

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
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

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// AI名称
const aiNames = ['小明', '小红', '老王', '阿强', '小美'];

// 创建房间
function createRoom() {
  return {
    code: generateRoomCode(),
    seats: [null, null, null, null, null, null], // 6个座位
    hostId: null,
    gameState: {
      deck: [],
      communityCards: [],
      pot: 0,
      currentBet: 0,
      phase: 'waiting',
      currentPlayerIndex: 0,
      gameActive: false,
      smallBlind: 5,
      bigBlind: 10,
      dealerIndex: 0,
      players: [],
      actedThisRound: [],
      lastRaisePlayerIndex: -1,
      roundActionCount: 0  // 本轮行动次数，防止无限循环
    }
  };
}

// 获取房间信息
function getRoomInfo(room) {
  return {
    code: room.code,
    seats: room.seats,
    hostId: room.hostId
  };
}

// 广播房间状态
function broadcastRoomState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  io.to(roomCode).emit('roomUpdate', getRoomInfo(room));
}

// 广播游戏状态
function broadcastGameState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  
  const gs = room.gameState;
  const isGameOver = gs.phase === 'showdown' || gs.phase === 'finished';
  
  room.seats.forEach((seat, index) => {
    if (!seat) return;
    
    const playerGameState = {
      ...gs,
      players: gs.players.map((p, i) => {
        if (!p) return null;
        
        // 计算牌型（游戏中只显示自己的，结束时显示所有人的）
        const handType = (p.id === seat.id || isGameOver) && p.hand && gs.communityCards && gs.communityCards.length >= 3
          ? getBestHandDescription(p.hand, gs.communityCards)
          : null;
        
        if (p.id === seat.id || isGameOver) {
          return { ...p, handType, connected: room.seats[i]?.connected ?? true };
        }
        return {
          ...p,
          handType: null,
          hand: p.hand && p.hand.length > 0 ? [{ hidden: true }, { hidden: true }] : [],
          connected: room.seats[i]?.connected ?? true
        };
      })
    };
    
    io.to(seat.id).emit('gameState', playerGameState);
  });
}

// 开始游戏
function startGame(room) {
  const gs = room.gameState;
  
  // 重置追踪
  resetTracking();
  
  // 获取所有有人的座位
  const activePlayers = room.seats.filter(s => s !== null);
  if (activePlayers.length < 2) return;
  
  // 初始化玩家
  gs.players = room.seats.map((seat, index) => {
    if (!seat) return null;
    return {
      id: seat.id,
      name: seat.name,
      chips: seat.chips,
      hand: [],
      bet: 0,
      folded: false,
      isAllIn: false,
      isAI: seat.isAI || false,
      index
    };
  });
  
  // 发牌
  gs.deck = shuffle(createDeck());
  gs.communityCards = [];
  gs.pot = 0;
  gs.currentBet = gs.bigBlind;
  gs.phase = 'preflop';
  gs.gameActive = true;
  gs.actedThisRound = [];
  gs.roundActionCount = 0;
  gs.dealerIndex = (gs.dealerIndex + 1) % 6;
  
  // 跳过空位找到庄家
  while (!gs.players[gs.dealerIndex]) {
    gs.dealerIndex = (gs.dealerIndex + 1) % 6;
  }
  
  // 发手牌
  gs.players.forEach(player => {
    if (player) {
      // 筹码为0的玩家自动跳过
      if (player.chips <= 0) {
        player.folded = true;
        player.hand = [];
      } else {
        player.hand = [gs.deck.pop(), gs.deck.pop()];
      }
    }
  });
  
  // 设置盲注 - 找到庄家后的两个有效玩家
  let sbIndex = (gs.dealerIndex + 1) % 6;
  while (!gs.players[sbIndex]) sbIndex = (sbIndex + 1) % 6;
  
  let bbIndex = (sbIndex + 1) % 6;
  while (!gs.players[bbIndex]) bbIndex = (bbIndex + 1) % 6;
  
  // 小盲
  const sbPlayer = gs.players[sbIndex];
  const actualSmallBlind = Math.min(gs.smallBlind, sbPlayer.chips);
  sbPlayer.chips -= actualSmallBlind;
  sbPlayer.bet = actualSmallBlind;
  if (sbPlayer.chips === 0) sbPlayer.isAllIn = true;
  
  // 大盲
  const bbPlayer = gs.players[bbIndex];
  const actualBigBlind = Math.min(gs.bigBlind, bbPlayer.chips);
  bbPlayer.chips -= actualBigBlind;
  bbPlayer.bet = actualBigBlind;
  if (bbPlayer.chips === 0) bbPlayer.isAllIn = true;
  
  gs.pot = actualSmallBlind + actualBigBlind;
  gs.currentBet = actualBigBlind;
  
  // 从大盲后开始
  gs.currentPlayerIndex = (bbIndex + 1) % 6;
  let safety = 0;
  while ((!gs.players[gs.currentPlayerIndex] || 
          gs.players[gs.currentPlayerIndex].folded || 
          gs.players[gs.currentPlayerIndex].isAllIn ||
          gs.players[gs.currentPlayerIndex].chips <= 0) && safety < 12) {
    gs.currentPlayerIndex = (gs.currentPlayerIndex + 1) % 6;
    safety++;
  }
  
  console.log(`游戏开始，当前玩家: ${gs.players[gs.currentPlayerIndex]?.name}, index: ${gs.currentPlayerIndex}`);
  
  broadcastGameState(room.code);
  
  // 如果当前是AI，延迟后自动行动
  checkAITurn(room);
}

// 检查是否轮到AI
function checkAITurn(room) {
  const gs = room.gameState;
  if (!gs.gameActive) return;
  
  const currentPlayer = gs.players[gs.currentPlayerIndex];
  if (!currentPlayer || !currentPlayer.isAI) return;
  
  // AI延迟500ms后行动
  setTimeout(() => aiTurn(room), 500);
}

// AI决策 - 使用职业牌手引擎
function aiTurn(room) {
  const gs = room.gameState;
  if (!gs.gameActive) return;
  
  const player = gs.players[gs.currentPlayerIndex];
  if (!player || !player.isAI || player.folded || player.isAllIn) {
    nextPlayer(room);
    return;
  }
  
  console.log(`AI ${player.name} 思考中...`);
  
  // 使用职业牌手AI引擎
  const result = aiDecision(player, gs, room);
  
  console.log(`AI ${player.name} 决策: ${result.action}, amount: ${result.amount}`);
  
  // 执行决策
  executeAction(room, player, result.action, result.amount || 0);
}

// 执行玩家行动
function executeAction(room, player, action, amount = 0) {
  const gs = room.gameState;
  const playerIndex = player.index;
  
  // 防止无限循环：每轮最多行动 100 次（正常德州不会超过 20 次）
  gs.roundActionCount++;
  if (gs.roundActionCount > 100) {
    console.log('行动次数过多，强制进入下一阶段');
    nextPhase(room);
    return;
  }
  
  console.log(`执行行动: ${player.name} ${action} ${amount}`);
  
  switch (action) {
    case 'fold':
      player.folded = true;
      break;
      
    case 'check':
      break;
      
    case 'call':
      const toCall = gs.currentBet - player.bet;
      if (toCall >= player.chips) {
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
      
      console.log(`加注: raiseAmount=${raiseAmount}, toCallNew=${toCallNew}, chips=${player.chips}`);
      
      if (toCallNew >= player.chips) {
        gs.pot += player.chips;
        player.bet += player.chips;
        player.chips = 0;
        player.isAllIn = true;
        gs.currentBet = Math.max(gs.currentBet, player.bet);
      } else {
        player.chips -= toCallNew;
        player.bet = raiseAmount;
        gs.currentBet = raiseAmount;
        gs.pot += toCallNew;
        gs.actedThisRound = [playerIndex];
      }
      break;
  }
  
  if (!gs.actedThisRound.includes(playerIndex)) {
    gs.actedThisRound.push(playerIndex);
  }
  
  broadcastGameState(room.code);
  nextPlayer(room);
}

// 下一个玩家
function nextPlayer(room) {
  const gs = room.gameState;
  
  // 检查是否只剩一个玩家
  const activePlayers = gs.players.filter(p => p && !p.folded);
  if (activePlayers.length === 1) {
    endRound(room, activePlayers[0]);
    return;
  }
  
  // 找下一个需要行动的玩家
  let nextIndex = (gs.currentPlayerIndex + 1) % 6;
  let startIndex = nextIndex;
  let loops = 0;
  
  while (loops < 6) {
    const nextP = gs.players[nextIndex];
    
    if (nextP && !nextP.folded && !nextP.isAllIn && nextP.chips > 0) {
      // 如果这个玩家还没行动，或者当前下注大于他的下注（有人加注）
      const needsToAct = !gs.actedThisRound.includes(nextIndex) || 
                         (gs.currentBet > nextP.bet);
      
      if (needsToAct) {
        gs.currentPlayerIndex = nextIndex;
        console.log(`下一个玩家: ${nextP.name}, index: ${nextIndex}, isAI: ${nextP.isAI}`);
        broadcastGameState(room.code);
        checkAITurn(room);
        return;
      }
    }
    
    nextIndex = (nextIndex + 1) % 6;
    if (nextIndex === startIndex) loops++;
  }
  
  console.log('进入下一阶段');
  // 进入下一阶段
  nextPhase(room);
}

// 下一阶段
function nextPhase(room) {
  const gs = room.gameState;
  
  // 重置
  gs.players.forEach(p => { if (p) p.bet = 0; });
  gs.currentBet = 0;
  gs.actedThisRound = [];
  gs.roundActionCount = 0;  // 重置行动计数
  
  switch (gs.phase) {
    case 'preflop':
      gs.phase = 'flop';
      gs.communityCards = [gs.deck.pop(), gs.deck.pop(), gs.deck.pop()];
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
  let startIndex = (gs.dealerIndex + 1) % 6;
  let found = false;
  for (let i = 0; i < 6; i++) {
    const player = gs.players[startIndex];
    if (player && !player.folded && !player.isAllIn && player.chips > 0) {
      gs.currentPlayerIndex = startIndex;
      found = true;
      console.log(`新阶段 ${gs.phase}，当前玩家: ${player.name}`);
      break;
    }
    startIndex = (startIndex + 1) % 6;
  }
  
  // 如果没找到可行动的玩家，直接摊牌
  if (!found) {
    console.log('没有可行动的玩家，直接摊牌');
    showdown(room);
    return;
  }
  
  broadcastGameState(room.code);
  checkAITurn(room);
}

// 摊牌
function showdown(room) {
  const gs = room.gameState;
  gs.phase = 'showdown';
  gs.gameActive = false; // 立即设为不活跃
  
  const activePlayers = gs.players.filter(p => p && !p.folded);
  
  // 真正的牌力比较
  let winner = null;
  let winnerEval = null;
  
  activePlayers.forEach(p => {
    const evalResult = evaluateHand([...p.hand, ...gs.communityCards]);
    console.log(`${p.name}: ${evalResult.name} (rank: ${evalResult.rank}, kickers: ${evalResult.kickers})`);
    
    if (!winner) {
      winner = p;
      winnerEval = evalResult;
    } else {
      // 比较牌力
      if (evalResult.rank > winnerEval.rank) {
        winner = p;
        winnerEval = evalResult;
      } else if (evalResult.rank === winnerEval.rank) {
        // 同牌型比较 kickers
        for (let i = 0; i < Math.max(evalResult.kickers.length, winnerEval.kickers.length); i++) {
          const k1 = evalResult.kickers[i] || 0;
          const k2 = winnerEval.kickers[i] || 0;
          if (k1 > k2) {
            winner = p;
            winnerEval = evalResult;
            break;
          } else if (k1 < k2) {
            break;
          }
        }
      }
    }
  });
  
  winner.chips += gs.pot;
  
  // 保存获胜者信息（包含牌型）
  const winnerHandType = winnerEval ? winnerEval.name : '高牌';
  gs.winner = { name: winner.name, chips: winner.chips, pot: gs.pot, handType: winnerHandType };
  
  // 为所有玩家添加牌型信息
  gs.players.forEach(p => {
    if (p && p.hand) {
      p.handType = getBestHandDescription(p.hand, gs.communityCards);
    }
  });
  
  console.log(`showdown: ${winner.name} 以 ${winnerHandType} 获胜，赢得 ${gs.pot} 筹码`);
  
  // 更新房间中玩家的筹码
  gs.players.forEach((p, i) => {
    if (p && room.seats[i]) {
      room.seats[i].chips = p.chips;
    }
  });
  
  // 直接设置为 finished，保持在这个画面直到下一局
  gs.phase = 'finished';
  broadcastGameState(room.code);
  broadcastRoomState(room.code);
}

// 结束一轮
function endRound(room, winner) {
  const gs = room.gameState;
  gs.phase = 'showdown';
  gs.gameActive = false; // 立即设为不活跃，防止AI继续行动
  winner.chips += gs.pot;
  
  // 获取获胜者牌型
  const winnerHandType = winner.hand ? getBestHandDescription(winner.hand, gs.communityCards) : '高牌';
  
  // 保存获胜者信息
  gs.winner = { name: winner.name, chips: winner.chips, pot: gs.pot, handType: winnerHandType };
  
  // 为所有玩家添加牌型信息
  gs.players.forEach(p => {
    if (p && p.hand) {
      p.handType = getBestHandDescription(p.hand, gs.communityCards);
    }
  });
  
  console.log(`endRound: ${winner.name} 以 ${winnerHandType} 获胜，赢得 ${gs.pot} 筹码`);
  
  // 更新房间中玩家的筹码
  gs.players.forEach((p, i) => {
    if (p && room.seats[i]) {
      room.seats[i].chips = p.chips;
    }
  });
  
  // 直接广播最终状态，保持在这个画面直到下一局
  gs.phase = 'finished';
  broadcastGameState(room.code);
  broadcastRoomState(room.code);
}

// Socket.IO
io.on('connection', (socket) => {
  console.log(`玩家连接: ${socket.id}`);
  
  // 创建房间
  socket.on('createRoom', (data) => {
    const room = createRoom();
    rooms.set(room.code, room);
    
    socket.join(room.code);
    
    // 自动坐第一个位置
    room.seats[0] = {
      id: socket.id,
      name: data.name || '玩家1',
      chips: 1000,
      ready: false,
      isHost: true,
      connected: true
    };
    room.hostId = socket.id;
    
    socket.emit('roomCreated', { roomCode: room.code, playerId: socket.id });
    broadcastRoomState(room.code);
  });
  
  // 加入房间
  socket.on('joinRoom', (data) => {
    const room = rooms.get(data.roomCode);
    
    if (!room) {
      socket.emit('error', { message: '房间不存在' });
      return;
    }
    
    if (room.gameState.gameActive) {
      socket.emit('error', { message: '游戏进行中' });
      return;
    }
    
    socket.join(data.roomCode);
    
    // 找空位坐下
    const emptyIndex = room.seats.findIndex(s => s === null);
    if (emptyIndex === -1) {
      socket.emit('error', { message: '房间已满' });
      return;
    }
    
    room.seats[emptyIndex] = {
      id: socket.id,
      name: data.name || `玩家${emptyIndex + 1}`,
      chips: 1000,
      ready: false,
      connected: true
    };
    
    socket.emit('roomJoined', { roomCode: data.roomCode, playerId: socket.id });
    broadcastRoomState(data.roomCode);
  });
  
  // 选择座位
  socket.on('selectSeat', (data) => {
    const room = rooms.get(data.roomCode);
    if (!room || room.gameState.gameActive) return;
    
    // 检查是否已在其他座位
    const existingIndex = room.seats.findIndex(s => s && s.id === socket.id);
    if (existingIndex !== -1) {
      room.seats[existingIndex] = null;
    }
    
    // 坐到新位置
    if (room.seats[data.seatIndex] === null) {
      const name = room.seats[existingIndex]?.name || '玩家';
      room.seats[data.seatIndex] = {
        id: socket.id,
        name,
        chips: 1000,
        ready: false,
        isHost: room.hostId === socket.id,
        connected: true
      };
    }
    
    broadcastRoomState(data.roomCode);
  });
  
  // 添加AI
  socket.on('addAI', (data) => {
    const room = rooms.get(data.roomCode);
    if (!room || room.gameState.gameActive) return;
    if (room.hostId !== socket.id) return;
    
    if (room.seats[data.seatIndex] === null) {
      const aiIndex = room.seats.filter(s => s && s.isAI).length;
      room.seats[data.seatIndex] = {
        id: `ai_${Date.now()}_${data.seatIndex}`,
        name: aiNames[aiIndex % aiNames.length] || `AI${data.seatIndex + 1}`,
        chips: 1000,
        ready: true, // AI默认准备
        isAI: true,
        connected: true // AI始终在线
      };
    }
    
    broadcastRoomState(data.roomCode);
  });
  
  // 移除AI
  socket.on('removeAI', (data) => {
    const room = rooms.get(data.roomCode);
    if (!room || room.gameState.gameActive) return;
    if (room.hostId !== socket.id) return;
    
    const seat = room.seats[data.seatIndex];
    if (seat && seat.isAI) {
      room.seats[data.seatIndex] = null;
    }
    
    broadcastRoomState(data.roomCode);
  });
  
  // 准备
  socket.on('ready', (data) => {
    const room = rooms.get(data.roomCode);
    if (!room) return;
    
    const seat = room.seats.find(s => s && s.id === socket.id);
    if (seat) {
      seat.ready = !seat.ready;
      broadcastRoomState(data.roomCode);
    }
  });
  
  // 开始游戏
  socket.on('startGame', (data) => {
    const room = rooms.get(data.roomCode);
    if (!room || room.hostId !== socket.id) return;
    
    const occupiedSeats = room.seats.filter(s => s !== null);
    const allReady = occupiedSeats.every(s => s.ready);
    
    if (occupiedSeats.length < 2 || !allReady) return;
    
    startGame(room);
  });
  
  // 玩家行动
  socket.on('playerAction', (data) => {
    const room = rooms.get(data.roomCode);
    if (!room) return;
    
    const gs = room.gameState;
    if (!gs.gameActive) return;
    
    const player = gs.players[gs.currentPlayerIndex];
    if (!player || player.id !== socket.id) return;
    
    // 记录玩家行动（用于AI追踪攻击性）
    recordPlayerAction(data.action);
    
    executeAction(room, player, data.action, data.amount || 0);
  });
  
  // 开始下一局
  socket.on('startNextGame', (roomCode) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    // 只有房主可以开始
    if (room.hostId !== socket.id) return;
    
    // 重新初始化玩家状态
    room.seats.forEach((seat, i) => {
      if (seat) {
        seat.folded = false;
        seat.bet = 0;
        seat.hand = null;
        seat.isAllIn = false;
        // 不再自动补充筹码，筹码为0的玩家会被跳过
        room.gameState.players[i] = seat;
      }
    });
    
    startGame(room);
  });
  
  // 重新加入房间（重连）
  socket.on('rejoinRoom', (data) => {
    const room = rooms.get(data.roomCode);
    if (!room) {
      socket.emit('error', { message: '房间不存在' });
      return;
    }
    
    // 查找是否有同名的座位（可能是之前断开的）
    const seatIndex = room.seats.findIndex(s => s && s.name === data.name && !s.isAI);
    
    if (seatIndex !== -1) {
      const seat = room.seats[seatIndex];
      const oldId = seat.id;
      seat.id = socket.id; // 更新为新 socket id
      seat.connected = true; // 恢复在线状态
      
      // 如果是房主，更新房主 id
      if (room.hostId === oldId) {
        room.hostId = socket.id;
      }
      
      // 如果游戏中有这个玩家，也更新 gameState 中的 id
      if (room.gameState && room.gameState.players) {
        const player = room.gameState.players[seatIndex];
        if (player) {
          player.id = socket.id;
        }
      }
      
      socket.join(data.roomCode);
      socket.emit('roomJoined', { roomCode: data.roomCode, playerId: socket.id });
      broadcastRoomState(data.roomCode);
      
      // 如果游戏正在进行，发送游戏状态
      if (room.gameState && room.gameState.gameActive) {
        broadcastGameState(data.roomCode);
      }
      
      console.log(`玩家 ${data.name} 重新连接`);
    }
  });
  
  // 断开连接
  socket.on('disconnect', () => {
    rooms.forEach((room, roomCode) => {
      const seatIndex = room.seats.findIndex(s => s && s.id === socket.id);
      if (seatIndex !== -1) {
        const seat = room.seats[seatIndex];
        
        // 如果游戏正在进行，保留座位一段时间等待重连
        if (room.gameState && room.gameState.gameActive) {
          console.log(`玩家 ${seat.name} 断开连接，等待重连...`);
          seat.connected = false; // 标记为断线
          broadcastRoomState(roomCode);
          // 不清空座位，等待重连
          return;
        }
        
        // 游戏未开始，清空座位
        room.seats[seatIndex] = null;
        
        // 转移房主
        if (room.hostId === socket.id) {
          const newHost = room.seats.find(s => s && !s.isAI);
          room.hostId = newHost ? newHost.id : null;
        }
        
        broadcastRoomState(roomCode);
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`德州扑克多人版运行在 http://localhost:${PORT}`);
});
