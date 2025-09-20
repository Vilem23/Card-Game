const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;

// KONFIGURACE KARET
const CARD_CONFIG = {
    PLAYER_START_HP: 100,
    MAIN_CARDS_PER_HAND: 2,
    SUPPORT_CARDS_PER_HAND: 2,
    GAMBLE_ATTEMPTS: 3,
    
    COUNTERS: {
        1: [3, 7],
        2: [4, 6],
    },
    
    COUNTER_BONUS: 15,
    
    MAIN_CARDS: [
        { 
            id: 1, 
            name: "Alfa", 
            damage: 50, 
            hp: 10,
            type: "main",
            cardType: "legend",
            gender: "male",
            ability: "Bonus damage do karet co jsou ženy.",
            description: "Má vlčí auru. Šuká přezrálé ženy.",
            image: "alfa.png",
            boost: ["vladimir", "tomas"],
            bestSupport: { id: 101, name: "Golden labubu", multiplier: 2 }
        },
        {
            id: 2,
            name: "Živý Mrtvý Chodící Děti",
            damage: 30,
            hp: 15,
            type: "main",
            cardType: "mindset",
            gender: "male",
            ability: "Bonus damage do chudých karet.",
            description: "Má všechny peníze na světě.",
            image: "chodicideti.png",
            bestSupport: { id: 101, name: "Golden labubu", multiplier: 1.5 }
        },
        {
            id: 3,
            name: "František Ředitel",
            damage: 30,
            hp: 15,
            type: "main",
            cardType: "mindset",
            gender: "male",
            ability: "Nezve Starosty na grilovačky.",
            description: "ocet, sul, sul, zahuštění, ovet, sul, ocet, šlehačka.",
            image: "frantisek.png"
        },
        {
            id: 4,
            name: "Tomáš Garrigue Masaryk",
            damage: 30,
            hp: 15,
            type: "main",
            cardType: "mindset",
            gender: "male",
            ability: "Reforma společnosti.",
            description: "Pokud je jeho spojencem státní instituce, zvyšuje svůj damage.",
            image: "tomas.png"
        },
    ],
    
    SUPPORT_CARDS: [
        {
            id: 101,
            name: "Golden labubu",
            type: "support",
            bonusDamage: 1.5,  // Multiplier, not addition
            bonusHeal: 2,       // Multiplier
            ability: "Zlato náboje zastaví.",
            description: "Doufám že chcípneš jestli tuto kartu nosíš.",
            image: "labubu.png"
        },
    ]
};

const lobbies = new Map();
const gameStates = new Map();

const generateLobbyCode = () => {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    return lobbies.has(code) ? generateLobbyCode() : code;
};

const getRandomCards = () => {
    const shuffledMainCards = [...CARD_CONFIG.MAIN_CARDS].sort(() => 0.5 - Math.random());
    const shuffledSupportCards = [...CARD_CONFIG.SUPPORT_CARDS].sort(() => 0.5 - Math.random());
    
    const selectedCards = [
        ...shuffledMainCards.slice(0, CARD_CONFIG.MAIN_CARDS_PER_HAND),
        ...shuffledSupportCards.slice(0, CARD_CONFIG.SUPPORT_CARDS_PER_HAND)
    ];
    
    return selectedCards.sort(() => 0.5 - Math.random());
};

const calculateBattleResult = (player1, player2, gameState) => {
    const card1 = player1.selectedCard;
    const card2 = player2.selectedCard;
    const support1 = player1.selectedSupport;
    const support2 = player2.selectedSupport;
    
    if (!card1 || !card2) return null;
    
    const battleCard1 = { ...card1, currentHp: card1.hp };
    const battleCard2 = { ...card2, currentHp: card2.hp };
    
    let damage1 = card1.damage;
    let damage2 = card2.damage;
    let healing1 = 0;
    let healing2 = 0;
    
    // Counter system
    let player1Counter = false;
    let player2Counter = false;
    let counterReason1 = '';
    let counterReason2 = '';
    
    if (CARD_CONFIG.COUNTERS[card1.id]?.includes(card2.id)) {
        damage1 += CARD_CONFIG.COUNTER_BONUS;
        player1Counter = true;
        counterReason1 = `${card1.name} má typ advantage proti ${card2.name}`;
    }
    if (CARD_CONFIG.COUNTERS[card2.id]?.includes(card1.id)) {
        damage2 += CARD_CONFIG.COUNTER_BONUS;
        player2Counter = true;
        counterReason2 = `${card2.name} má typ advantage proti ${card1.name}`;
    }
    
    // Boost system
    let boost1 = false;
    let boost2 = false;
    let boostReason1 = '';
    let boostReason2 = '';
    
    if (card1.boost) {
        const boostTargets = Array.isArray(card1.boost) ? card1.boost : [card1.boost];
        const targetMatch = boostTargets.find(target => 
            card2.name.toLowerCase().includes(target.toLowerCase())
        );
        if (targetMatch) {
            damage1 += 10;
            boost1 = true;
            boostReason1 = `${card1.name} má boost proti "${targetMatch}"`;
        }
    }
    
    if (card2.boost) {
        const boostTargets = Array.isArray(card2.boost) ? card2.boost : [card2.boost];
        const targetMatch = boostTargets.find(target => 
            card1.name.toLowerCase().includes(target.toLowerCase())
        );
        if (targetMatch) {
            damage2 += 10;
            boost2 = true;
            boostReason2 = `${card2.name} má boost proti "${targetMatch}"`;
        }
    }
    
    // Support bonuses (MULTIPLICATIVE now)
    let supportMultiplier1 = 1;
    let supportMultiplier2 = 1;
    
    if (support1 && support1.type === 'support') {
        // Check if this is the best support for the card
        if (card1.bestSupport && card1.bestSupport.id === support1.id) {
            supportMultiplier1 = card1.bestSupport.multiplier || 1.5;
        } else {
            supportMultiplier1 = support1.bonusDamage || 1;
        }
        damage1 = Math.floor(damage1 * supportMultiplier1);
        healing1 = Math.floor(10 * (support1.bonusHeal || 1)); // Base heal is 10
    }
    
    if (support2 && support2.type === 'support') {
        // Check if this is the best support for the card
        if (card2.bestSupport && card2.bestSupport.id === support2.id) {
            supportMultiplier2 = card2.bestSupport.multiplier || 1.5;
        } else {
            supportMultiplier2 = support2.bonusDamage || 1;
        }
        damage2 = Math.floor(damage2 * supportMultiplier2);
        healing2 = Math.floor(10 * (support2.bonusHeal || 1)); // Base heal is 10
    }
    
    // Calculate damage
    let damageToCard2 = Math.max(0, damage1);
    let overflowDamageToPlayer2 = 0;
    
    if (damageToCard2 >= battleCard2.currentHp) {
        overflowDamageToPlayer2 = damageToCard2 - battleCard2.currentHp;
        battleCard2.currentHp = 0;
    } else {
        battleCard2.currentHp -= damageToCard2;
    }
    
    let damageToCard1 = Math.max(0, damage2);
    let overflowDamageToPlayer1 = 0;
    
    if (damageToCard1 >= battleCard1.currentHp) {
        overflowDamageToPlayer1 = damageToCard1 - battleCard1.currentHp;
        battleCard1.currentHp = 0;
    } else {
        battleCard1.currentHp -= damageToCard1;
    }
    
    // Apply damage and healing to players
    player1.hp = Math.max(0, Math.min(100, player1.hp - overflowDamageToPlayer1 + healing1));
    player2.hp = Math.max(0, Math.min(100, player2.hp - overflowDamageToPlayer2 + healing2));
    
    // Determine round winner
    let roundWinner = null;
    const totalDamage1 = damageToCard2 + overflowDamageToPlayer2;
    const totalDamage2 = damageToCard1 + overflowDamageToPlayer1;
    
    if (totalDamage1 > totalDamage2) roundWinner = player1;
    else if (totalDamage2 > totalDamage1) roundWinner = player2;
    
    return {
        player1: {
            id: player1.id,
            name: player1.name,
            card: card1,
            support: support1,
            damageDealt: damage1,
            cardDamageTaken: damageToCard1,
            playerDamageTaken: overflowDamageToPlayer1,
            healed: healing1,
            hp: player1.hp,
            cardSurvived: battleCard1.currentHp > 0
        },
        player2: {
            id: player2.id,
            name: player2.name,
            card: card2,
            support: support2,
            damageDealt: damage2,
            cardDamageTaken: damageToCard2,
            playerDamageTaken: overflowDamageToPlayer2,
            healed: healing2,
            hp: player2.hp,
            cardSurvived: battleCard2.currentHp > 0
        },
        roundWinner,
        counters: {
            player1Counter,
            player2Counter,
            counterReason1,
            counterReason2
        },
        boosts: {
            player1Boost: boost1,
            player2Boost: boost2,
            boostReason1,
            boostReason2
        },
        gameOver: player1.hp <= 0 || player2.hp <= 0
    };
};

const evaluateRound = (lobbyCode) => {
    const gameState = gameStates.get(lobbyCode);
    if (!gameState?.players || gameState.players.length !== 2) return;
    
    const [player1, player2] = gameState.players;
    const result = calculateBattleResult(player1, player2, gameState);
    
    if (!result) return;
    
    // Send HP update immediately
    io.to(lobbyCode).emit('hpUpdate', {
        player1HP: player1.hp,
        player2HP: player2.hp
    });
    
    io.to(lobbyCode).emit('roundResult', result);
    
    // Check if game is over
    if (result.gameOver) {
        let winner = null;
        let loser = null;
        
        if (player1.hp > 0) {
            winner = player1;
            loser = player2;
        } else if (player2.hp > 0) {
            winner = player2;
            loser = player1;
        }
        
        // Send game end event
        io.to(lobbyCode).emit('gameEnded', {
            winner: winner || 'tie',
            loser,
            rounds: gameState.round
        });
        
        gameState.status = 'ended';
    } else {
        // Automatically prepare next round after delay
        setTimeout(() => prepareNextRound(lobbyCode), 3000);
    }
};

const prepareNextRound = (lobbyCode) => {
    const gameState = gameStates.get(lobbyCode);
    if (!gameState || gameState.status === 'ended') return;
    
    gameState.round++;
    gameState.players.forEach(player => {
        player.selectedCard = null;
        player.selectedSupport = null;
        player.ready = false;
        player.cards = getRandomCards();
        // Add inventory card if exists
        if (player.inventoryCard) {
            player.cards.push(player.inventoryCard);
            player.inventoryCard = null;
        }
        player.gamblesUsed = 0;
    });
    
    io.to(lobbyCode).emit('nextRound', { 
        round: gameState.round, 
        message: 'Nové kolo! Vyberte hlavní a support kartu.' 
    });
    
    gameState.players.forEach(player => {
        io.to(player.id).emit('yourCards', { 
            allCards: player.cards, 
            round: gameState.round,
            inventoryCard: player.inventoryCard
        });
    });
};

// SOCKET HANDLERS
io.on('connection', (socket) => {
    console.log('Hráč připojen:', socket.id);

    socket.on('createLobby', (data) => {
        const lobbyCode = generateLobbyCode();
        const lobby = {
            code: lobbyCode,
            host: socket.id,
            players: [{ id: socket.id, name: data.playerName, isHost: true, ready: false }]
        };

        lobbies.set(lobbyCode, lobby);
        socket.join(lobbyCode);
        socket.lobbyCode = lobbyCode;

        socket.emit('lobbyCreated', { lobbyCode });
        socket.emit('playersUpdate', lobby.players);
    });

    socket.on('joinLobby', (data) => {
        const { playerName, lobbyCode } = data;
        const lobby = lobbies.get(lobbyCode);

        if (!lobby) return socket.emit('error', { message: 'Lobby neexistuje!' });
        if (lobby.players.length >= 2) return socket.emit('error', { message: 'Lobby je plné!' });
        if (lobby.players.some(p => p.name === playerName)) return socket.emit('error', { message: 'Jméno již existuje!' });

        const newPlayer = { id: socket.id, name: playerName, isHost: false, ready: false };
        lobby.players.push(newPlayer);
        socket.join(lobbyCode);
        socket.lobbyCode = lobbyCode;

        socket.emit('lobbyJoined', { lobbyCode });
        io.to(lobbyCode).emit('playersUpdate', lobby.players);
        socket.to(lobbyCode).emit('playerJoined', { playerName });
    });

    socket.on('startGame', () => {
        if (!socket.lobbyCode) return;
        
        const lobby = lobbies.get(socket.lobbyCode);
        if (!lobby || lobby.host !== socket.id || lobby.players.length < 2) return;

        const gameState = {
            players: lobby.players.map(player => ({
                id: player.id,
                name: player.name,
                hp: CARD_CONFIG.PLAYER_START_HP,
                cards: getRandomCards(),
                selectedCard: null,
                selectedSupport: null,
                ready: false,
                gamblesUsed: 0,
                inventoryCard: null
            })),
            round: 1,
            status: 'selecting'
        };
        
        gameStates.set(socket.lobbyCode, gameState);
        io.to(socket.lobbyCode).emit('gameStarted', { gameState });
        
        gameState.players.forEach(player => {
            io.to(player.id).emit('yourCards', { 
                allCards: player.cards, 
                round: gameState.round 
            });
        });
    });

    socket.on('selectCard', (data) => {
        const gameState = gameStates.get(socket.lobbyCode);
        if (!gameState) return;
        
        const player = gameState.players.find(p => p.id === socket.id);
        if (!player) return;
        
        const selectedCard = player.cards.find(c => c.id === data.cardId);
        if (!selectedCard) return socket.emit('error', { message: 'Nemáš tuto kartu!' });
        
        if (data.isSupport) {
            if (selectedCard.type !== 'support') {
                return socket.emit('error', { message: 'Tuto kartu nelze použít jako support!' });
            }
            player.selectedSupport = selectedCard;
            socket.emit('supportSelected', { message: `Support: ${selectedCard.name}`, card: selectedCard });
        } else {
            if (selectedCard.type !== 'main') {
                return socket.emit('error', { message: 'Tuto kartu nelze použít jako hlavní!' });
            }
            player.selectedCard = selectedCard;
            socket.emit('cardSelected', { message: `Hlavní: ${selectedCard.name}`, card: selectedCard });
        }
        
        player.ready = false;
        
        // Send update to all players - show the actual card to all
        io.to(socket.lobbyCode).emit('gameUpdate', { 
            gameState: {
                ...gameState,
                players: gameState.players.map(p => ({
                    ...p,
                    selectedCard: p.selectedCard,
                    selectedSupport: p.selectedSupport,
                    cards: p.id === socket.id ? p.cards : [] // Only send own cards
                }))
            }
        });
    });

    socket.on('unselectCard', (data) => {
        const gameState = gameStates.get(socket.lobbyCode);
        if (!gameState) return;
        
        const player = gameState.players.find(p => p.id === socket.id);
        if (!player) return;
        
        if (data.isSupport) {
            player.selectedSupport = null;
        } else {
            player.selectedCard = null;
        }
        
        player.ready = false;
        
        // Send update to all
        io.to(socket.lobbyCode).emit('gameUpdate', { 
            gameState: {
                ...gameState,
                players: gameState.players.map(p => ({
                    ...p,
                    selectedCard: p.selectedCard,
                    selectedSupport: p.selectedSupport,
                    cards: p.id === socket.id ? p.cards : []
                }))
            }
        });
    });

    socket.on('saveToInventory', (data) => {
        const gameState = gameStates.get(socket.lobbyCode);
        if (!gameState) return;
        
        const player = gameState.players.find(p => p.id === socket.id);
        if (!player || player.inventoryCard) return;
        
        const card = player.cards.find(c => c.id === data.cardId);
        if (!card) return;
        
        player.inventoryCard = card;
        player.cards = player.cards.filter(c => c.id !== data.cardId);
        
        socket.emit('yourCards', { 
            allCards: player.cards, 
            round: gameState.round,
            inventoryCard: player.inventoryCard
        });
    });

    socket.on('useFromInventory', (data) => {
        const gameState = gameStates.get(socket.lobbyCode);
        if (!gameState) return;
        
        const player = gameState.players.find(p => p.id === socket.id);
        if (!player || !player.inventoryCard) return;
        
        player.cards.push(player.inventoryCard);
        player.inventoryCard = null;
        
        socket.emit('yourCards', { 
            allCards: player.cards, 
            round: gameState.round,
            inventoryCard: null
        });
    });

    socket.on('gambleCards', () => {
        const gameState = gameStates.get(socket.lobbyCode);
        if (!gameState) return;
        
        const player = gameState.players.find(p => p.id === socket.id);
        if (!player) return;
        
        if (player.gamblesUsed >= CARD_CONFIG.GAMBLE_ATTEMPTS) {
            return socket.emit('error', { message: 'Nemáš další pokusy na gamble!' });
        }
        
        player.selectedCard = null;
        player.selectedSupport = null;
        player.ready = false;
        player.gamblesUsed++;
        
        player.cards = getRandomCards();
        
        io.to(player.id).emit('yourCards', { 
            allCards: player.cards, 
            round: gameState.round,
            gamblesUsed: player.gamblesUsed,
            gamblesLeft: CARD_CONFIG.GAMBLE_ATTEMPTS - player.gamblesUsed,
            inventoryCard: player.inventoryCard
        });
        
        socket.emit('gambleResult', { 
            message: `Gamble ${player.gamblesUsed}/${CARD_CONFIG.GAMBLE_ATTEMPTS} použit!`,
            gamblesLeft: CARD_CONFIG.GAMBLE_ATTEMPTS - player.gamblesUsed
        });
    });

    socket.on('playerReady', () => {
        const gameState = gameStates.get(socket.lobbyCode);
        if (!gameState) return;
        
        const player = gameState.players.find(p => p.id === socket.id);
        if (!player?.selectedCard) return;
        
        player.ready = true;
        const notReadyPlayers = gameState.players.filter(p => !p.ready || !p.selectedCard).map(p => p.name);
        
        if (notReadyPlayers.length > 0) {
            io.to(socket.lobbyCode).emit('readyUpdate', { waitingFor: notReadyPlayers });
        } else {
            evaluateRound(socket.lobbyCode);
        }
    });

    socket.on('playAgain', () => {
        const gameState = gameStates.get(socket.lobbyCode);
        if (!gameState || gameState.status !== 'ended') return;
        
        // Reset game
        gameState.players.forEach(player => {
            player.hp = CARD_CONFIG.PLAYER_START_HP;
            player.cards = getRandomCards();
            player.selectedCard = null;
            player.selectedSupport = null;
            player.ready = false;
            player.gamblesUsed = 0;
            player.inventoryCard = null;
        });
        
        gameState.round = 1;
        gameState.status = 'selecting';
        
        io.to(socket.lobbyCode).emit('gameStarted', { gameState });
        
        gameState.players.forEach(player => {
            io.to(player.id).emit('yourCards', { 
                allCards: player.cards, 
                round: gameState.round 
            });
        });
    });

    socket.on('returnToLobby', () => {
        const gameState = gameStates.get(socket.lobbyCode);
        const lobby = lobbies.get(socket.lobbyCode);
        
        if (!gameState || !lobby) return;
        
        gameStates.delete(socket.lobbyCode);
        io.to(socket.lobbyCode).emit('playersUpdate', lobby.players);
    });

    socket.on('leaveLobby', () => {
        if (!socket.lobbyCode) return;
        
        const lobby = lobbies.get(socket.lobbyCode);
        if (!lobby) return;
        
        const playerIndex = lobby.players.findIndex(p => p.id === socket.id);
        if (playerIndex === -1) return;
        
        const leavingPlayer = lobby.players[playerIndex];
        lobby.players.splice(playerIndex, 1);
        socket.leave(socket.lobbyCode);
        
        if (lobby.players.length === 0) {
            lobbies.delete(socket.lobbyCode);
            gameStates.delete(socket.lobbyCode);
        } else {
            if (leavingPlayer.isHost) {
                lobby.players[0].isHost = true;
                lobby.host = lobby.players[0].id;
            }
            io.to(socket.lobbyCode).emit('playersUpdate', lobby.players);
            socket.to(socket.lobbyCode).emit('playerLeft', { playerName: leavingPlayer.name });
        }
        
        socket.lobbyCode = null;
    });

    socket.on('disconnect', () => {
        console.log('Hráč odpojen:', socket.id);
        if (socket.lobbyCode) {
            const lobby = lobbies.get(socket.lobbyCode);
            if (lobby) {
                const player = lobby.players.find(p => p.id === socket.id);
                if (player) {
                    lobby.players = lobby.players.filter(p => p.id !== socket.id);
                    if (lobby.players.length === 0) {
                        lobbies.delete(socket.lobbyCode);
                        gameStates.delete(socket.lobbyCode);
                    } else {
                        io.to(socket.lobbyCode).emit('playersUpdate', lobby.players);
                        socket.to(socket.lobbyCode).emit('playerLeft', { playerName: player.name });
                    }
                }
            }
        }
    });
});

app.use(express.static(path.join(__dirname, 'public')));

server.listen(PORT, () => {
    console.log(`Server běží na portu ${PORT}`);
    console.log(`Otevři http://localhost:${PORT}`);
    console.log(`Balíček obsahuje ${CARD_CONFIG.MAIN_CARDS.length} hlavních karet a ${CARD_CONFIG.SUPPORT_CARDS.length} support karet`);
});

process.on('SIGTERM', () => {
    console.log('Server se ukončuje...');
    server.close(() => console.log('Server ukončen.'));
});