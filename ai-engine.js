// T1 职业牌手 AI 引擎 v2（大幅加强版）

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// 全局追踪玩家行为
let playerAggression = 0.3;
let playerRaiseCount = 0;
let playerTotalActions = 0;

// AI风格配置
function getAIPlayerStyle(playerId) {
    const styles = [
        { aggression: 0.85, bluffRate: 0.35, callRate: 0.7, name: '职业TAG' },
        { aggression: 0.8, bluffRate: 0.3, callRate: 0.75, name: 'GTO专家' },
        { aggression: 0.9, bluffRate: 0.4, callRate: 0.8, name: '职业LAG' },
        { aggression: 0.95, bluffRate: 0.45, callRate: 0.85, name: '超凶鲨鱼' },
        { aggression: 0.82, bluffRate: 0.32, callRate: 0.72, name: '策略大师' }
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
    
    let strength = 0.2;
    
    if (isPair) {
        strength = 0.5 + (rank1 / RANKS.length) * 0.45;
    } else {
        strength = (highCard / RANKS.length) * 0.3;
        if (isSuited) strength += 0.1;
        if (gap <= 2) strength += 0.08;
        if (highCard >= 11 && gap <= 2) strength += 0.15;
    }
    
    // 有公共牌时评估成牌
    if (community && community.length > 0) {
        const allCards = [...hand, ...community];
        const handRank = evaluateHand(allCards);
        if (handRank.rank >= 3) strength = Math.max(strength, 0.7);
        else if (handRank.rank >= 2) strength = Math.max(strength, 0.5);
        else if (handRank.rank >= 1) strength = Math.max(strength, 0.35);
    }
    
    return Math.min(strength, 1);
}

// 详细牌力评估
function evaluateHandStrengthDetailed(hand, community) {
    const allCards = [...(hand || []), ...(community || [])];
    if (allCards.length < 2) return { tier: 1, drawStrength: 0 };
    
    const handRank = evaluateHand(allCards);
    const drawStrength = evaluateDrawStrength(hand, community);
    
    // tier: 1=高牌, 2=一对, 3=两对/三条, 4=顺子/同花/葫芦, 5=四条/同花顺
    let tier = 1;
    if (handRank.rank >= 7) tier = 5;
    else if (handRank.rank >= 5) tier = 4;
    else if (handRank.rank >= 3) tier = 3;
    else if (handRank.rank >= 1) tier = 2;
    
    return { tier, drawStrength };
}

// 评估一手牌（完整版，返回可用于比较的分值）
function evaluateHand(cards) {
    if (!cards || cards.length < 5) {
        // 手牌评估
        if (cards && cards.length === 2) {
            const r1 = RANKS.indexOf(cards[0].rank);
            const r2 = RANKS.indexOf(cards[1].rank);
            if (cards[0].rank === cards[1].rank) return { rank: 1, name: '一对', highCard: r1, kickers: [r1, r1] };
            const high = Math.max(r1, r2);
            return { rank: 0, name: '高牌', highCard: high, kickers: [high, Math.min(r1, r2)] };
        }
        return { rank: 0, name: '高牌', highCard: 0, kickers: [] };
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
    
    // A-2-3-4-5 特殊顺子
    if (sortedRanks.includes(12) && sortedRanks.includes(0) && sortedRanks.includes(1) && sortedRanks.includes(2) && sortedRanks.includes(3)) {
        isStraight = true;
        straightHigh = 3; // 5高顺子
    }
    
    for (let i = 0; i <= sortedRanks.length - 5; i++) {
        if (sortedRanks[i + 4] - sortedRanks[i] === 4) {
            isStraight = true;
            straightHigh = sortedRanks[i + 4];
        }
    }
    
    const counts = Object.values(rankCounts).sort((a, b) => b - a);
    
    // 获取所有牌按出现次数和大小排序
    const getSortedRanks = () => {
        const arr = [];
        for (const [rank, count] of Object.entries(rankCounts)) {
            arr.push({ rank: RANKS.indexOf(rank), count });
        }
        return arr.sort((a, b) => b.count - a.count || b.rank - a.rank).map(x => x.rank);
    };
    const sortedByCount = getSortedRanks();
    
    if (isStraight && isFlush) return { rank: 8, name: '同花顺', highCard: straightHigh, kickers: [straightHigh] };
    if (counts[0] === 4) return { rank: 7, name: '四条', highCard: sortedByCount[0], kickers: sortedByCount };
    if (counts[0] === 3 && counts[1] >= 2) return { rank: 6, name: '葫芦', highCard: sortedByCount[0], kickers: sortedByCount.slice(0, 2) };
    if (isFlush) {
        const flushCards = cards.filter(c => suitCounts[c.suit] >= 5).map(c => RANKS.indexOf(c.rank)).sort((a, b) => b - a).slice(0, 5);
        return { rank: 5, name: '同花', highCard: flushCards[0], kickers: flushCards };
    }
    if (isStraight) return { rank: 4, name: '顺子', highCard: straightHigh, kickers: [straightHigh] };
    if (counts[0] === 3) return { rank: 3, name: '三条', highCard: sortedByCount[0], kickers: sortedByCount.slice(0, 3) };
    if (counts[0] === 2 && counts[1] === 2) return { rank: 2, name: '两对', highCard: sortedByCount[0], kickers: sortedByCount.slice(0, 3) };
    if (counts[0] === 2) return { rank: 1, name: '一对', highCard: sortedByCount[0], kickers: sortedByCount.slice(0, 4) };
    
    return { rank: 0, name: '高牌', highCard: ranks[0], kickers: ranks.slice(0, 5) };
}

// 比较两手牌，返回胜者（1表示hand1胜，-1表示hand2胜，0平局）
function compareHands(hand1, community, hand2) {
    const eval1 = evaluateHand([...hand1, ...community]);
    const eval2 = evaluateHand([...hand2, ...community]);
    
    if (eval1.rank !== eval2.rank) {
        return eval1.rank > eval2.rank ? 1 : -1;
    }
    
    // 同牌型比较 kickers
    for (let i = 0; i < Math.max(eval1.kickers.length, eval2.kickers.length); i++) {
        const k1 = eval1.kickers[i] || 0;
        const k2 = eval2.kickers[i] || 0;
        if (k1 !== k2) return k1 > k2 ? 1 : -1;
    }
    
    return 0;
}

// 获取最佳牌型描述
function getBestHandDescription(hand, community) {
    const allCards = [...hand, ...community];
    if (allCards.length < 5) {
        // 只有手牌
        if (hand && hand.length === 2) {
            if (hand[0].rank === hand[1].rank) return '一对';
            return '高牌';
        }
        return '高牌';
    }
    const result = evaluateHand(allCards);
    return result.name;
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
function getPositionAdvantage(playerIndex) {
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
        return 0.5 + r1 * 0.02;
    }
    
    let strength = 0.2;
    strength += (high / 12) * 0.35;
    if (isSuited) strength += 0.1;
    if (gap <= 1) strength += 0.12;
    
    if (high === 12 && low === 11) strength = 0.9;
    else if (high === 12 && low === 10) strength = 0.8;
    else if (high === 11 && low === 10) strength = 0.7;
    
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
    
    return high + low + suffix;
}

// 主AI决策函数
function aiDecision(player, gameState, room) {
    const toCall = gameState.currentBet - player.bet;
    const style = getAIPlayerStyle(player.index);
    const positionAdv = getPositionAdvantage(player.index);
    const potOddsForCall = toCall > 0 ? toCall / (gameState.pot + toCall) : 0;
    const potOddsGood = potOddsForCall < 0.35;
    const potOddsDecent = potOddsForCall < 0.5;
    const callCost = player.chips > 0 ? toCall / player.chips : 1;
    const spr = player.chips > 0 ? player.chips / Math.max(1, gameState.pot) : 0;
    
    let decision = 'fold';
    let raiseAmount = 0;
    
    // 牌力评估
    const handStrength = evaluateHandStrength(player.hand, gameState.communityCards);
    const detailedStrength = evaluateHandStrengthDetailed(player.hand, gameState.communityCards);
    const drawStrength = detailedStrength.drawStrength || 0;
    
    // 检测玩家攻击性（用于判断是否诈唬）
    const highBluffSuspicion = playerAggression > 0.5;
    
    console.log(`AI ${player.name}: tier=${detailedStrength.tier}, strength=${handStrength.toFixed(2)}, toCall=${toCall}, potOdds=${potOddsForCall.toFixed(2)}, suspicion=${highBluffSuspicion}`);
    
    // 翻牌前策略
    if (gameState.phase === 'preflop') {
        const preflopStrength = getPreflopStrength(player.hand);
        const handType = getHandType(player.hand);
        const preflopPotOdds = toCall > 0 ? toCall / (gameState.pot + toCall) : 0;
        
        if (toCall > 0) {
            // 面对加注
            if (preflopStrength > 0.8) {
                decision = Math.random() < 0.7 ? 'raise' : 'call';
            } else if (preflopStrength > 0.65) {
                decision = Math.random() < 0.5 ? 'raise' : 'call';
            } else if (preflopStrength > 0.5) {
                decision = Math.random() < 0.35 ? 'raise' : 'call';
            } else if (preflopStrength > 0.4) {
                if (preflopPotOdds < 0.35 || highBluffSuspicion) {
                    decision = Math.random() < 0.7 ? 'call' : 'fold';
                } else {
                    decision = Math.random() < 0.6 ? 'call' : 'fold';
                }
            } else if (preflopStrength > 0.3) {
                if (preflopPotOdds < 0.2 || highBluffSuspicion) {
                    decision = Math.random() < 0.6 ? 'call' : 'fold';
                }
            } else if (highBluffSuspicion && preflopPotOdds < 0.15) {
                decision = Math.random() < 0.4 ? 'call' : 'fold';
            }
        } else {
            // 没人加注
            if (preflopStrength > 0.5) {
                decision = Math.random() < style.aggression ? 'raise' : 'check';
            } else if (preflopStrength > 0.35 && positionAdv > 0.6) {
                decision = Math.random() < (style.bluffRate * 1.5) ? 'raise' : 'check';
            } else if (positionAdv > 0.8) {
                decision = Math.random() < style.bluffRate ? 'raise' : 'check';
            } else {
                decision = 'check';
            }
        }
        
        if (decision === 'raise') {
            const baseRaise = gameState.bigBlind * (2 + positionAdv * 2);
            raiseAmount = Math.min(Math.floor(baseRaise * (0.8 + Math.random() * 0.4)), player.chips + player.bet);
            const minRaise = gameState.currentBet + gameState.bigBlind;
            raiseAmount = Math.max(raiseAmount, minRaise);
        }
    } else {
        // 翻牌后策略 - 更激进
        if (detailedStrength.tier >= 4) {
            // 超强牌
            if (toCall === 0) {
                decision = Math.random() < 0.7 ? 'raise' : 'check';
            } else {
                decision = Math.random() < 0.6 ? 'raise' : 'call';
            }
        } else if (detailedStrength.tier >= 3) {
            // 强牌（两对、三条）
            if (toCall === 0) {
                decision = Math.random() < 0.65 ? 'raise' : 'check';
            } else {
                // 几乎永远不弃
                decision = Math.random() < 0.85 ? 'call' : (Math.random() < 0.5 ? 'raise' : 'call');
            }
        } else if (detailedStrength.tier >= 2) {
            // 中等牌（一对）
            if (toCall === 0) {
                decision = Math.random() < 0.55 ? 'raise' : 'check';
            } else {
                // 职业牌手一对也难弃
                if (potOddsGood) {
                    decision = Math.random() < 0.9 ? 'call' : 'fold';
                } else if (potOddsDecent) {
                    decision = Math.random() < 0.8 ? 'call' : 'fold';
                } else if (potOddsForCall < 0.7) {
                    decision = Math.random() < 0.7 ? 'call' : 'fold';
                } else if (highBluffSuspicion) {
                    // 怀疑诈唬也要抓
                    decision = Math.random() < 0.55 ? 'call' : 'fold';
                } else {
                    decision = Math.random() < 0.45 ? 'call' : 'fold';
                }
            }
        } else if (drawStrength > 0.3) {
            // 听牌
            if (toCall === 0) {
                decision = Math.random() < 0.5 ? 'raise' : 'check';
            } else if (potOddsForCall < drawStrength) {
                decision = 'call';
            } else {
                decision = Math.random() < 0.4 ? 'call' : 'fold';
            }
        } else {
            // 弱牌
            if (toCall === 0) {
                // 选时机诈唬
                if (positionAdv > 0.6 && Math.random() < style.bluffRate) {
                    decision = 'raise';
                } else {
                    decision = 'check';
                }
            } else {
                // 面对下注：看赔率和诈唬嫌疑
                if (highBluffSuspicion && potOddsGood) {
                    decision = Math.random() < 0.55 ? 'call' : 'fold';
                } else if (highBluffSuspicion && potOddsDecent) {
                    decision = Math.random() < 0.4 ? 'call' : 'fold';
                } else if (potOddsGood) {
                    decision = Math.random() < 0.35 ? 'call' : 'fold';
                }
            }
        }
        
        // 翻牌后加注计算
        if (decision === 'raise') {
            const pot = gameState.pot;
            if (detailedStrength.tier >= 4) {
                raiseAmount = Math.floor(pot * (0.7 + Math.random() * 0.3));
            } else if (detailedStrength.tier >= 3) {
                raiseAmount = Math.floor(pot * (0.55 + Math.random() * 0.25));
            } else {
                raiseAmount = Math.floor(pot * (0.4 + Math.random() * 0.2));
            }
            
            const minRaise = Math.max(gameState.currentBet + gameState.bigBlind, Math.floor(pot * 0.4));
            raiseAmount = Math.max(raiseAmount, minRaise);
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
        } else if (handStrength > 0.45 && callCost > 0.5) {
            decision = Math.random() < 0.6 ? 'allin' : 'fold';
        } else if (highBluffSuspicion && detailedStrength.tier >= 2) {
            decision = Math.random() < 0.5 ? 'allin' : 'fold';
        } else {
            decision = 'fold';
        }
        
        if (decision === 'allin') {
            return { action: 'call', amount: 0 };
        }
    }
    
    // 更新玩家攻击性追踪
    if (decision === 'fold') {
        playerTotalActions++;
    }
    
    return { action: decision, amount: raiseAmount };
}

// 记录玩家行动（用于追踪攻击性）
function recordPlayerAction(action) {
    playerTotalActions++;
    if (action === 'raise') {
        playerRaiseCount++;
        playerAggression = Math.min(1, playerAggression + 0.1);
    } else if (action === 'fold') {
        playerAggression = Math.max(0.2, playerAggression - 0.05);
    }
    
    // 基于加注频率更新
    if (playerTotalActions > 5) {
        const raiseFreq = playerRaiseCount / playerTotalActions;
        playerAggression = 0.3 + raiseFreq * 0.6;
    }
}

// 重置追踪（新一局）
function resetTracking() {
    playerAggression = 0.3;
    playerRaiseCount = 0;
    playerTotalActions = 0;
}

module.exports = {
    aiDecision,
    recordPlayerAction,
    resetTracking,
    getAIPlayerStyle,
    evaluateHandStrength,
    evaluateHand,
    compareHands,
    getBestHandDescription
};
