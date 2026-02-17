// T1 职业牌手 AI 引擎（移植自 T0）

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// AI风格配置
function getAIPlayerStyle(playerId) {
    const styles = [
        { 
            aggression: 0.82, bluffRate: 0.28, cbetRate: 0.78, foldTo3bet: 0.3,
            name: '职业TAG',
            gto: {
                aa: { raise: 0.85, call: 0.15 }, kk: { raise: 0.8, call: 0.2 },
                qq: { raise: 0.7, call: 0.3 }, ak: { raise: 0.75, call: 0.25 },
                aq: { raise: 0.6, call: 0.4 }
            }
        },
        { 
            aggression: 0.75, bluffRate: 0.25, cbetRate: 0.72, foldTo3bet: 0.32,
            name: 'GTO专家',
            gto: {
                aa: { raise: 0.8, call: 0.2 }, kk: { raise: 0.75, call: 0.25 },
                qq: { raise: 0.65, call: 0.35 }, ak: { raise: 0.72, call: 0.28 },
                aq: { raise: 0.58, call: 0.42 }
            }
        },
        { 
            aggression: 0.88, bluffRate: 0.35, cbetRate: 0.85, foldTo3bet: 0.22,
            name: '职业LAG',
            gto: {
                aa: { raise: 0.78, call: 0.22 }, kk: { raise: 0.72, call: 0.28 },
                qq: { raise: 0.6, call: 0.4 }, ak: { raise: 0.8, call: 0.2 },
                aq: { raise: 0.68, call: 0.32 }
            }
        },
        { 
            aggression: 0.92, bluffRate: 0.4, cbetRate: 0.9, foldTo3bet: 0.15,
            name: '超凶鲨鱼',
            gto: {
                aa: { raise: 0.75, call: 0.25 }, kk: { raise: 0.7, call: 0.3 },
                qq: { raise: 0.55, call: 0.45 }, ak: { raise: 0.82, call: 0.18 },
                aq: { raise: 0.75, call: 0.25 }
            }
        },
        { 
            aggression: 0.78, bluffRate: 0.3, cbetRate: 0.75, foldTo3bet: 0.28,
            name: '策略大师',
            gto: {
                aa: { raise: 0.82, call: 0.18 }, kk: { raise: 0.78, call: 0.22 },
                qq: { raise: 0.68, call: 0.32 }, ak: { raise: 0.78, call: 0.22 },
                aq: { raise: 0.62, call: 0.38 }
            }
        }
    ];
    return styles[(playerId - 1) % styles.length];
}

// 牌力评估
function evaluateHandStrength(hand, community) {
    if (!hand || hand.length < 2) return 0.3;
    
    const rank1 = RANKS.indexOf(hand[0].rank);
    const rank2 = RANKS.indexOf(hand[1].rank);
    const isPair = hand[0].rank === hand[1].rank;
    const isSuited = hand[0].suit === hand[1].suit;
    const highCard = Math.max(rank1, rank2);
    const gap = Math.abs(rank1 - rank2);
    
    let strength = 0.15;
    
    if (isPair) {
        strength = 0.45 + (rank1 / RANKS.length) * 0.45;
    } else {
        strength = (highCard / RANKS.length) * 0.25;
        if (isSuited) strength += 0.08;
        if (gap <= 2) strength += 0.06;
        if (highCard >= 11 && gap <= 2) strength += 0.12;
    }
    
    return Math.min(strength, 1);
}

// 详细牌力评估
function evaluateHandStrengthDetailed(hand, community) {
    const allCards = [...hand, ...(community || [])];
    if (allCards.length < 2) return { tier: 1, name: '高牌', drawStrength: 0 };
    
    const handRank = evaluateHand(allCards);
    const drawStrength = evaluateDrawStrength(hand, community);
    
    let tier = 1;
    if (handRank.rank >= 8) tier = 5;
    else if (handRank.rank === 7) tier = 4;
    else if (handRank.rank >= 5) tier = 3;
    else if (handRank.rank >= 3) tier = 2;
    
    return { tier, name: handRank.name, drawStrength };
}

// 评估一手牌
function evaluateHand(cards) {
    if (!cards || cards.length < 5) {
        return { rank: 0, name: '高牌', highCard: 0 };
    }
    
    const rankCounts = {};
    const suitCounts = {};
    
    cards.forEach(card => {
        rankCounts[card.rank] = (rankCounts[card.rank] || 0) + 1;
        suitCounts[card.suit] = (suitCounts[card.suit] || 0) + 1;
    });
    
    const ranks = Object.keys(rankCounts).map(r => RANKS.indexOf(r)).sort((a, b) => b - a);
    const isFlush = Object.values(suitCounts).some(c => c >= 5);
    
    // 检测顺子
    let isStraight = false;
    let straightHigh = 0;
    const sortedRanks = [...new Set(cards.map(c => RANKS.indexOf(c.rank)))].sort((a, b) => a - b);
    for (let i = 0; i <= sortedRanks.length - 5; i++) {
        if (sortedRanks[i + 4] - sortedRanks[i] === 4) {
            isStraight = true;
            straightHigh = sortedRanks[i + 4];
        }
    }
    // A-2-3-4-5 顺子
    if (sortedRanks.includes(12) && sortedRanks.includes(0) && sortedRanks.includes(1) && sortedRanks.includes(2) && sortedRanks.includes(3)) {
        isStraight = true;
        straightHigh = 3;
    }
    
    const counts = Object.values(rankCounts).sort((a, b) => b - a);
    
    if (isStraight && isFlush) return { rank: 8, name: '同花顺', highCard: straightHigh };
    if (counts[0] === 4) return { rank: 7, name: '四条', highCard: ranks[0] };
    if (counts[0] === 3 && counts[1] === 2) return { rank: 6, name: '葫芦', highCard: ranks[0] };
    if (isFlush) return { rank: 5, name: '同花', highCard: ranks[0] };
    if (isStraight) return { rank: 4, name: '顺子', highCard: straightHigh };
    if (counts[0] === 3) return { rank: 3, name: '三条', highCard: ranks[0] };
    if (counts[0] === 2 && counts[1] === 2) return { rank: 2, name: '两对', highCard: ranks[0] };
    if (counts[0] === 2) return { rank: 1, name: '一对', highCard: ranks[0] };
    
    return { rank: 0, name: '高牌', highCard: ranks[0] };
}

// 听牌评估
function evaluateDrawStrength(hand, community) {
    if (!hand || hand.length < 2) return 0;
    if (!community || community.length === 0) return 0.1;
    
    const allCards = [...hand, ...community];
    const suitCounts = {};
    allCards.forEach(c => suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1);
    
    const maxSuit = Math.max(...Object.values(suitCounts));
    if (maxSuit >= 4) return 0.35;
    if (maxSuit === 3) return 0.15;
    
    return 0.05;
}

// 位置优势
function getPositionAdvantage(playerIndex, totalPlayers) {
    const positions = [0.5, 0.3, 0.4, 0.6, 0.8, 1.0];
    return positions[playerIndex % 6];
}

// 翻牌前手牌强度
function getPreflopStrength(hand) {
    if (!hand || hand.length < 2) return 0.3;
    
    const r1 = RANKS.indexOf(hand[0].rank);
    const r2 = RANKS.indexOf(hand[1].rank);
    const isPair = hand[0].rank === hand[1].rank;
    const isSuited = hand[0].suit === hand[1].suit;
    const high = Math.max(r1, r2);
    const low = Math.min(r1, r2);
    const gap = high - low;
    
    if (isPair) {
        if (r1 >= 12) return 1.0;
        if (r1 >= 11) return 0.92;
        if (r1 >= 10) return 0.85;
        if (r1 >= 9) return 0.72;
        if (r1 >= 8) return 0.62;
        return 0.5 + r1 * 0.02;
    }
    
    let strength = 0.2;
    strength += (high / 12) * 0.3;
    
    if (isSuited) strength += 0.08;
    if (gap <= 1) strength += 0.1;
    else if (gap <= 2) strength += 0.05;
    
    if (high === 12 && low === 11) strength = 0.88;
    else if (high === 12 && low === 10) strength = 0.78;
    else if (high === 11 && low === 10) strength = 0.68;
    
    return Math.min(strength, 1);
}

// 获取手牌类型
function getHandType(hand) {
    if (!hand || hand.length < 2) return 'unknown';
    const r1 = hand[0].rank;
    const r2 = hand[1].rank;
    const suited = hand[0].suit === hand[1].suit;
    
    if (r1 === r2) {
        if (r1 === 'A') return 'AA';
        if (r1 === 'K') return 'KK';
        if (r1 === 'Q') return 'QQ';
        if (r1 === 'J') return 'JJ';
        return r1 + r1;
    }
    
    const high = RANKS.indexOf(r1) > RANKS.indexOf(r2) ? r1 : r2;
    const low = RANKS.indexOf(r1) > RANKS.indexOf(r2) ? r2 : r1;
    const suffix = suited ? 's' : 'o';
    
    if (high === 'A' && low === 'K') return 'AK' + suffix;
    if (high === 'A' && low === 'Q') return 'AQ' + suffix;
    if (high === 'A' && low === 'J') return 'AJ' + suffix;
    if (high === 'K' && low === 'Q') return 'KQ' + suffix;
    
    return high + low + suffix;
}

// 判断是否面对3-bet
function isFacing3Bet(currentBet, bigBlind) {
    return currentBet > bigBlind * 3;
}

// 分析牌面结构
function analyzeBoardTexture(community) {
    if (!community || community.length < 3) return 'dry';
    
    const suits = community.map(c => c.suit);
    const ranks = community.map(c => RANKS.indexOf(c.rank));
    
    const suitCounts = {};
    suits.forEach(s => suitCounts[s] = (suitCounts[s] || 0) + 1);
    const maxSuit = Math.max(...Object.values(suitCounts));
    
    if (maxSuit >= 3) return 'wet';
    
    const connected = ranks.some((r, i) => 
        i < ranks.length - 1 && Math.abs(r - ranks[i + 1]) <= 2
    );
    if (connected) return 'wet';
    
    return 'dry';
}

// 主AI决策函数
function aiDecision(player, gameState, room) {
    const toCall = gameState.currentBet - player.bet;
    const style = getAIPlayerStyle(player.index);
    const positionAdv = getPositionAdvantage(player.index, 6);
    const potOddsForCall = toCall > 0 ? toCall / (gameState.pot + toCall) : 0;
    const potOddsGood = potOddsForCall < 0.33;
    const potOddsDecent = potOddsForCall < 0.5;
    const callCost = player.chips > 0 ? toCall / player.chips : 1;
    const spr = player.chips > 0 ? player.chips / Math.max(1, gameState.pot) : 0;
    const facing3bet = isFacing3Bet(gameState.currentBet, gameState.bigBlind);
    const boardTexture = analyzeBoardTexture(gameState.communityCards);
    
    let decision = 'fold';
    let raiseAmount = 0;
    
    // 牌力评估
    const handStrength = evaluateHandStrength(player.hand, gameState.communityCards);
    const detailedStrength = evaluateHandStrengthDetailed(player.hand, gameState.communityCards);
    const drawStrength = detailedStrength.drawStrength || 0;
    
    // GTO决策辅助
    function gtoDecision(handType) {
        const gto = style.gto;
        if (!gto) return null;
        
        let freq = null;
        if (handType === 'AA') freq = gto.aa;
        else if (handType === 'KK') freq = gto.kk;
        else if (handType === 'QQ') freq = gto.qq;
        else if (handType.startsWith('AK')) freq = gto.ak;
        else if (handType.startsWith('AQ')) freq = gto.aq;
        
        if (!freq) return null;
        return Math.random() < freq.raise ? 'raise' : 'call';
    }
    
    // 翻牌前策略
    if (gameState.phase === 'preflop') {
        const preflopStrength = getPreflopStrength(player.hand);
        const handType = getHandType(player.hand);
        const preflopPotOdds = toCall > 0 ? toCall / (gameState.pot + toCall) : 0;
        
        if (toCall > 0) {
            if (facing3bet) {
                if (handType === 'AA' || handType === 'KK') {
                    decision = Math.random() < 0.7 ? 'raise' : 'call';
                } else if (handType === 'QQ') {
                    decision = Math.random() < 0.55 ? 'raise' : 'call';
                } else if (handType.startsWith('AK')) {
                    decision = Math.random() < 0.65 ? 'call' : 'fold';
                } else if (handType === 'JJ') {
                    decision = Math.random() < 0.55 ? 'call' : 'fold';
                } else if (preflopStrength > 0.5 && preflopPotOdds < 0.28) {
                    decision = Math.random() < 0.45 ? 'call' : 'fold';
                } else {
                    decision = 'fold';
                }
            } else {
                if (preflopStrength > 0.8) {
                    decision = Math.random() < 0.75 ? 'raise' : 'call';
                } else if (preflopStrength > 0.65) {
                    decision = Math.random() < 0.55 ? 'raise' : 'call';
                } else if (preflopStrength > 0.5) {
                    if (positionAdv > 0.6) decision = Math.random() < 0.4 ? 'raise' : 'call';
                    else decision = Math.random() < 0.3 ? 'raise' : 'call';
                } else if (preflopStrength > 0.4) {
                    if (preflopPotOdds < 0.35) decision = Math.random() < 0.35 ? 'raise' : 'call';
                    else decision = Math.random() < 0.7 ? 'call' : 'fold';
                } else if (preflopStrength > 0.3) {
                    if (preflopPotOdds < 0.18) decision = 'call';
                    else decision = Math.random() < 0.55 ? 'call' : 'fold';
                } else if (positionAdv > 0.8 && preflopPotOdds < 0.15) {
                    decision = Math.random() < 0.35 ? 'call' : 'fold';
                } else {
                    decision = 'fold';
                }
            }
        } else {
            if (preflopStrength > 0.55) {
                decision = Math.random() < (style.aggression * 1.2) * (1 + positionAdv * 0.5) ? 'raise' : 'check';
            } else if (preflopStrength > 0.4 && positionAdv > 0.65) {
                decision = Math.random() < (style.bluffRate * 1.8) ? 'raise' : 'check';
            } else if (preflopStrength > 0.3 && positionAdv > 0.75) {
                decision = Math.random() < (style.bluffRate * 1.5) ? 'raise' : 'check';
            } else if (positionAdv > 0.85) {
                decision = Math.random() < (style.bluffRate * 1.3) ? 'raise' : 'check';
            } else {
                decision = 'check';
            }
        }
        
        // 计算加注金额
        if (decision === 'raise') {
            if (facing3bet) {
                raiseAmount = Math.min(gameState.currentBet * 3 + gameState.pot * 0.5, player.chips + player.bet);
            } else {
                const baseRaise = gameState.bigBlind * (2 + positionAdv * 2);
                raiseAmount = Math.min(Math.floor(baseRaise * (0.8 + Math.random() * 0.4)), player.chips + player.bet);
            }
            const minRaise = gameState.currentBet + gameState.bigBlind;
            raiseAmount = Math.max(raiseAmount, minRaise);
        }
    } else {
        // 翻牌后策略
        if (detailedStrength.tier >= 4) {
            if (toCall === 0) {
                decision = Math.random() < 0.65 ? 'raise' : 'check';
            } else {
                decision = Math.random() < 0.7 ? 'raise' : 'call';
            }
        } else if (detailedStrength.tier >= 3) {
            if (toCall === 0) {
                decision = Math.random() < 0.6 ? 'raise' : 'check';
            } else {
                if (potOddsDecent) decision = Math.random() < 0.4 ? 'raise' : 'call';
                else if (potOddsForCall < 0.65) decision = Math.random() < 0.82 ? 'call' : 'fold';
                else decision = Math.random() < 0.5 ? 'call' : 'fold';
            }
        } else if (detailedStrength.tier >= 2) {
            if (toCall === 0) {
                decision = Math.random() < 0.55 ? 'raise' : 'check';
            } else {
                if (potOddsGood) decision = Math.random() < 0.85 ? 'call' : 'fold';
                else if (potOddsDecent) decision = Math.random() < 0.72 ? 'call' : 'fold';
                else if (potOddsForCall < 0.65) decision = Math.random() < 0.55 ? 'call' : 'fold';
                else decision = Math.random() < 0.4 ? 'call' : 'fold';
            }
        } else if (drawStrength > 0.35) {
            if (toCall === 0) {
                decision = Math.random() < style.aggression * 0.7 ? 'raise' : 'check';
            } else if (potOddsForCall < drawStrength * 0.9) {
                decision = 'call';
            } else if (Math.random() < 0.32) {
                decision = 'raise';
            } else {
                decision = Math.random() < 0.4 ? 'call' : 'fold';
            }
        } else if (detailedStrength.tier >= 1) {
            if (toCall === 0) {
                const bluffCondition = positionAdv > 0.6 && boardTexture === 'dry';
                decision = (Math.random() < style.bluffRate * 1.2 && bluffCondition) ? 'raise' : 'check';
            } else {
                if (potOddsGood) decision = Math.random() < 0.4 ? 'call' : 'fold';
                else decision = 'fold';
            }
        } else {
            if (toCall === 0) {
                decision = Math.random() < style.bluffRate * 0.9 ? 'raise' : 'check';
            } else {
                decision = 'fold';
            }
        }
        
        // 翻牌后加注计算
        if (decision === 'raise') {
            const pot = gameState.pot;
            if (detailedStrength.tier >= 4) {
                raiseAmount = Math.floor(pot * (0.66 + Math.random() * 0.34));
            } else if (detailedStrength.tier >= 3) {
                raiseAmount = Math.floor(pot * (0.5 + Math.random() * 0.25));
            } else if (drawStrength > 0.35) {
                raiseAmount = Math.floor(pot * (0.5 + Math.random() * 0.17));
            } else if (detailedStrength.tier >= 2) {
                raiseAmount = Math.floor(pot * (0.33 + Math.random() * 0.17));
            } else {
                raiseAmount = Math.floor(pot * (0.25 + Math.random() * 0.15));
            }
            
            const minRaise = Math.floor(Math.max(gameState.currentBet + gameState.bigBlind, gameState.pot * 0.5));
            raiseAmount = Math.floor(Math.max(raiseAmount, minRaise));
            raiseAmount = Math.min(raiseAmount, player.chips + player.bet);
        }
    }
    
    // All in 决策
    if (toCall >= player.chips && decision !== 'fold') {
        if (detailedStrength.tier >= 4) {
            decision = 'allin';
        } else if (detailedStrength.tier >= 3 && spr < 5) {
            decision = 'allin';
        } else if (detailedStrength.tier >= 2 && spr < 3) {
            decision = 'allin';
        } else if (handStrength > 0.48 && callCost > 0.5) {
            decision = 'allin';
        } else {
            decision = Math.random() < 0.4 ? 'allin' : 'fold';
        }
        
        if (decision === 'allin') {
            return { action: 'call', amount: 0 }; // All in 等同于call所有筹码
        }
    }
    
    return { action: decision, amount: raiseAmount };
}

module.exports = {
    aiDecision,
    getAIPlayerStyle,
    evaluateHandStrength,
    evaluateHandStrengthDetailed,
    getPreflopStrength,
    getHandType
};
