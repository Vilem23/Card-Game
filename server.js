const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// DEFINICE KARET - zde můžete měnit statistiky
const CARD_DECK = [
    { id: 1, name: "Ohnivá koule", damage: 25, emoji: "🔥", color: "#ff4444" },
    { id: 2, name: "Ledový blesk", damage: 20, emoji: "❄️", color: "#4488ff" },
    { id: 3, name: "Blesk", damage: 30, emoji: "⚡", color: "#ffff44" },
    { id: 4, name: "Kamenná pěst", damage: 35, emoji: "👊", color: "#8b4513" },
    { id: 5, name: "Výbuch", damage: 40, emoji: "💥", color: "#ff8800" },
    { id: 6, name: "Magické šípy", damage: 15, emoji: "🏹", color: "#44ff44" },
    { id: 7, name: "Meč", damage: 28, emoji: "⚔️", color: "#c0c0c0" },
    { id: 8, name: "Kladivo", damage: 32, emoji: "🔨", color: "#8b4513" },
    { id: 9, name: "Štít", damage: 12, emoji: "🛡️", color: "#4169e1" },
    { id: 10, name: "Dračí dech", damage: 45, emoji: "🐉", color: "#8b0000" },
    { id: 11, name: "Tornádo", damage: 38, emoji: "🌪️", color: "#87ceeb" },
    { id: 12, name: "Zemětřesení", damage: 42, emoji: "🌍", color: "#8b4513" }
];

// Funkce pro zamíchání karet
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// Funkce pro rozdání karet hráčům
function dealCards(playerCount, cardsPerPlayer = 5) {
    const shuffledDeck = shuffleArray(CARD_DECK);
    const playerHands = [];
    
    for (let i = 0; i < playerCount; i++) {
        playerHands.push(shuffledDeck.slice(i * cardsPerPlayer, (i + 1) * cardsPerPlayer));
    }
    
    return playerHands;
}

// Funkce pro vyhodnocení kola
function evaluateRound(lobbyCode) {
    const gameState = gameStates.get(lobbyCode);
    if (!gameState || gameState.players.length !== 2) return;
    
    const [player1, player2] = gameState.players;
    const card1 = player1.selectedCard;
    const card2 = player2.selectedCard;
    
    let winner = 0; // 0 = remíza, 1 = player1, 2 = player2
    
    if (card1.damage > card2.damage) {
        winner = 1;
        player2.hp -= card1.damage;
    } else if (card2.damage > card1.damage) {
        winner = 2;
        player1.hp -= card2.damage;
    } else {
        // Remíza - oba dostávají damage
        player1.hp -= card2.damage;
        player2.hp -= card1.damage;
    }
    
    // Ujisti se, že HP neklesne pod 0
    player1.hp = Math.max(0, player1.hp);
    player2.hp = Math.max(0, player2.hp);
    
    const roundResult = {
        player1: {
            name: player1.name,
            card: card1,
            hp: player1.hp,
            damageTaken: winner === 2 || winner === 0 ? card2.damage : 0
        },
        player2: {
            name: player2.name,
            card: card2,
            hp: player2.hp,
            damageTaken: winner === 1 || winner === 0 ? card1.damage : 0
        },
        winner,
        gameOver: player1.hp <= 0 || player2.hp <= 0
    };
    
    // Pošli výsledek kola
    io.to(lobbyCode).emit('roundResult', roundResult);
    
    if (roundResult.gameOver) {
        let gameWinner;
        if (player1.hp <= 0 && player2.hp <= 0) {
            gameWinner = 'tie';
        } else if (player1.hp <= 0) {
            gameWinner = player2;
        } else {
            gameWinner = player1;
        }
        
        roundResult.gameWinner = gameWinner;
        
        // Vymaž herní stav
        gameStates.delete(lobbyCode);
    } else {
        // Připrav další kolo
        setTimeout(() => {
            prepareNextRound(lobbyCode);
        }, 3000);
    }
}

// Příprava dalšího kola
function prepareNextRound(lobbyCode) {
    const gameState = gameStates.get(lobbyCode);
    if (!gameState) return;
    
    gameState.round++;
    
    // Odstraň použité karty a reset stavu
    gameState.players.forEach(player => {
        if (player.selectedCard) {
            player.cards = player.cards.filter(c => c.id !== player.selectedCard.id);
        }
        player.selectedCard = null;
        player.ready = false;
    });
    
    // Pošli nové karty
    io.to(lobbyCode).emit('nextRound', {
        round: gameState.round,
        message: 'Vyberte kartu pro další kolo!'
    });
    
    gameState.players.forEach(player => {
        io.to(player.id).emit('yourCards', { 
            cards: player.cards,
            round: gameState.round
        });
    });
}

// Herní stav pro každé lobby
const gameStates = new Map();

// Servování statických souborů z public složky
app.use(express.static(path.join(__dirname, 'public')));

// Úložiště lobby
const lobbies = new Map();

// Funkce pro generování náhodného kódu lobby
function generateLobbyCode() {
    const chars = '0123456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    if (lobbies.has(code)) {
        return generateLobbyCode();
    }
    return code;
}

// Socket.IO připojení - VŠECHNY socket.on() MUSÍ BÝT UVNITŘ TOHOTO BLOKU!
io.on('connection', (socket) => {
    console.log('Hráč se připojil:', socket.id);

    // Vytvoření lobby
    socket.on('createLobby', (data) => {
        const lobbyCode = generateLobbyCode();
        const lobby = {
            code: lobbyCode,
            host: socket.id,
            players: [{
                id: socket.id,
                name: data.playerName,
                isHost: true,
                ready: false
            }]
        };

        lobbies.set(lobbyCode, lobby);
        socket.join(lobbyCode);
        socket.lobbyCode = lobbyCode;

        socket.emit('lobbyCreated', { lobbyCode });
        socket.emit('playersUpdate', lobby.players);
        
        console.log(`Lobby ${lobbyCode} bylo vytvořeno hráčem ${data.playerName}`);
    });

    // Připojení do lobby
    socket.on('joinLobby', (data) => {
        const { playerName, lobbyCode } = data;
        const lobby = lobbies.get(lobbyCode);

        if (!lobby) {
            socket.emit('error', { message: 'Lobby s tímto kódem neexistuje!' });
            return;
        }

        if (lobby.players.length >= 4) {
            socket.emit('error', { message: 'Lobby je plné!' });
            return;
        }

        const nameExists = lobby.players.some(player => player.name === playerName);
        if (nameExists) {
            socket.emit('error', { message: 'Toto jméno už někdo používá!' });
            return;
        }

        const newPlayer = {
            id: socket.id,
            name: playerName,
            isHost: false,
            ready: false
        };

        lobby.players.push(newPlayer);
        socket.join(lobbyCode);
        socket.lobbyCode = lobbyCode;

        socket.emit('lobbyJoined', { lobbyCode });
        io.to(lobbyCode).emit('playersUpdate', lobby.players);
        socket.to(lobbyCode).emit('playerJoined', { playerName });
        
        console.log(`${playerName} se připojil do lobby ${lobbyCode}`);
    });

    // Začátek hry - NOVÁ IMPLEMENTACE S KARTAMI
    socket.on('startGame', () => {
        if (socket.lobbyCode) {
            const lobby = lobbies.get(socket.lobbyCode);
            if (lobby && lobby.host === socket.id && lobby.players.length >= 2) {
                
                // Vytvoření herního stavu
                const playerHands = dealCards(lobby.players.length, 5);
                const gameState = {
                    players: lobby.players.map((player, index) => ({
                        id: player.id,
                        name: player.name,
                        hp: 100,
                        cards: playerHands[index],
                        selectedCard: null,
                        ready: false
                    })),
                    round: 1,
                    status: 'selecting'
                };
                
                gameStates.set(socket.lobbyCode, gameState);
                
                // Pošli herní stav všem
                io.to(socket.lobbyCode).emit('gameStarted', { gameState });
                
                // Pošli každému hráči jeho karty
                gameState.players.forEach(player => {
                    io.to(player.id).emit('yourCards', { 
                        cards: player.cards,
                        round: gameState.round
                    });
                });
                
                console.log(`Hra začala v lobby ${socket.lobbyCode} s ${lobby.players.length} hráči`);
            }
        }
    });

    // Výběr karty
    socket.on('selectCard', (data) => {
        if (!socket.lobbyCode) return;
        
        const gameState = gameStates.get(socket.lobbyCode);
        if (!gameState) return;
        
        const player = gameState.players.find(p => p.id === socket.id);
        if (!player) return;
        
        const selectedCard = player.cards.find(c => c.id === data.cardId);
        if (!selectedCard) return;
        
        player.selectedCard = selectedCard;
        player.ready = false;
        
        socket.emit('cardSelected', { 
            message: `Vybral jsi ${selectedCard.name}! Klikni na Připraven!`,
            card: selectedCard
        });
        
        // Pošli update ostatním (bez odhalení karty)
        io.to(socket.lobbyCode).emit('gameUpdate', { 
            gameState: {
                ...gameState,
                players: gameState.players.map(p => ({
                    ...p,
                    selectedCard: p.id === socket.id ? selectedCard : 
                        (p.selectedCard ? { hidden: true } : null)
                }))
            }
        });
    });

    // Zrušení výběru karty
    socket.on('unselectCard', () => {
        if (!socket.lobbyCode) return;
        
        const gameState = gameStates.get(socket.lobbyCode);
        if (!gameState) return;
        
        const player = gameState.players.find(p => p.id === socket.id);
        if (!player) return;
        
        player.selectedCard = null;
        player.ready = false;
        
        io.to(socket.lobbyCode).emit('gameUpdate', { gameState });
    });

    // Hráč připraven
    socket.on('playerReady', () => {
        if (!socket.lobbyCode) return;
        
        const gameState = gameStates.get(socket.lobbyCode);
        if (!gameState) return;
        
        const player = gameState.players.find(p => p.id === socket.id);
        if (!player || !player.selectedCard) return;
        
        player.ready = true;
        
        const notReadyPlayers = gameState.players
            .filter(p => !p.ready || !p.selectedCard)
            .map(p => p.name);
        
        if (notReadyPlayers.length > 0) {
            io.to(socket.lobbyCode).emit('readyUpdate', { 
                waitingFor: notReadyPlayers
            });
        } else {
            // Všichni připraveni - vyhodnoť kolo
            evaluateRound(socket.lobbyCode);
        }
    });

    // Vyhození hráče
    socket.on('kickPlayer', (data) => {
        console.log('🦵 Kick request:', data, 'od:', socket.id);
        
        const { lobbyCode, playerName } = data;
        const targetLobbyCode = lobbyCode || socket.lobbyCode;
        const lobby = lobbies.get(targetLobbyCode);
        
        if (!lobby) {
            socket.emit('kickError', { message: 'Lobby neexistuje' });
            return;
        }
        
        const requester = lobby.players.find(p => p.id === socket.id);
        if (!requester || !requester.isHost) {
            socket.emit('kickError', { message: 'Nemáš oprávnění vyhazovat hráče' });
            return;
        }
        
        const playerToKick = lobby.players.find(p => p.name === playerName);
        if (!playerToKick) {
            socket.emit('kickError', { message: 'Hráč nenalezen' });
            return;
        }
        
        const kickedSocket = io.sockets.sockets.get(playerToKick.id);
        lobby.players = lobby.players.filter(p => p.name !== playerName);
        
        if (kickedSocket) {
            kickedSocket.leave(targetLobbyCode);
            kickedSocket.lobbyCode = null;
            kickedSocket.emit('playerKicked', { 
                kickedPlayer: playerName,
                message: 'Byl jsi vyhozen z lobby'
            });
        }
        
        io.to(targetLobbyCode).emit('playerKicked', { 
            kickedPlayer: playerName,
            message: `${playerName} byl vyhozen z lobby`
        });
        
        io.to(targetLobbyCode).emit('playersUpdate', lobby.players);
    });

    // Opuštění lobby
    socket.on('leaveLobby', () => {
        if (socket.lobbyCode) {
            const lobby = lobbies.get(socket.lobbyCode);
            if (lobby) {
                const playerIndex = lobby.players.findIndex(player => player.id === socket.id);
                if (playerIndex !== -1) {
                    const leavingPlayer = lobby.players[playerIndex];
                    lobby.players.splice(playerIndex, 1);

                    socket.leave(socket.lobbyCode);
                    socket.to(socket.lobbyCode).emit('playerLeft', { playerName: leavingPlayer.name });

                    if (lobby.players.length === 0) {
                        lobbies.delete(socket.lobbyCode);
                        gameStates.delete(socket.lobbyCode);
                        console.log(`Lobby ${socket.lobbyCode} bylo smazáno`);
                    } else {
                        if (leavingPlayer.isHost && lobby.players.length > 0) {
                            lobby.players[0].isHost = true;
                            lobby.host = lobby.players[0].id;
                        }
                        io.to(socket.lobbyCode).emit('playersUpdate', lobby.players);
                    }
                }
            }
            socket.lobbyCode = null;
        }
    });

    // Odpojení hráče
    socket.on('disconnect', () => {
        console.log('Hráč se odpojil:', socket.id);
        
        if (socket.lobbyCode) {
            const lobby = lobbies.get(socket.lobbyCode);
            if (lobby) {
                const playerIndex = lobby.players.findIndex(player => player.id === socket.id);
                if (playerIndex !== -1) {
                    const leavingPlayer = lobby.players[playerIndex];
                    lobby.players.splice(playerIndex, 1);

                    socket.to(socket.lobbyCode).emit('playerLeft', { playerName: leavingPlayer.name });

                    if (lobby.players.length === 0) {
                        lobbies.delete(socket.lobbyCode);
                        gameStates.delete(socket.lobbyCode);
                    } else {
                        if (leavingPlayer.isHost && lobby.players.length > 0) {
                            lobby.players[0].isHost = true;
                            lobby.host = lobby.players[0].id;
                        }
                        io.to(socket.lobbyCode).emit('playersUpdate', lobby.players);
                    }
                }
            }
        }
    });
});

// Spuštění serveru
server.listen(PORT, () => {
    console.log(`🚀 Server běží na portu ${PORT}`);
    console.log(`📱 Otevři http://localhost:${PORT} v prohlížeči`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Server se ukončuje...');
    server.close(() => {
        console.log('Server ukončen.');
    });
});