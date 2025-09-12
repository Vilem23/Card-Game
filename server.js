const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Servování statických souborů z public složky
app.use(express.static(path.join(__dirname, 'public')));

// Úložiště lobby
const lobbies = new Map();

// Funkce pro generování náhodného kódu lobby - POUZE ČÍSLICE
function generateLobbyCode() {
    const chars = '0123456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // Zkontroluj, jestli kód už neexistuje
    if (lobbies.has(code)) {
        return generateLobbyCode();
    }
    return code;
}

// Socket.IO připojení
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

        // Zkontroluj, jestli jméno už není použité
        const nameExists = lobby.players.some(player => player.name === playerName);
        if (nameExists) {
            socket.emit('error', { message: 'Toto jméno už někdo používá!' });
            return;
        }

        // Přidej hráče do lobby
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
        
        // Pošli aktualizaci všem hráčům v lobby
        io.to(lobbyCode).emit('playersUpdate', lobby.players);
        socket.to(lobbyCode).emit('playerJoined', { playerName });
        
        console.log(`${playerName} se připojil do lobby ${lobbyCode}`);
    });

    // Vyhození hráče - UVNITŘ connection handleru
    socket.on('kickPlayer', (data) => {
        console.log('🦵 Kick request:', data, 'od:', socket.id);
        
        const { lobbyCode, playerName } = data;
        
        // Použij lobbyCode z dat nebo ze socket
        const targetLobbyCode = lobbyCode || socket.lobbyCode;
        const lobby = lobbies.get(targetLobbyCode);
        
        if (!lobby) {
            console.log('❌ Lobby neexistuje:', targetLobbyCode);
            socket.emit('kickError', { message: 'Lobby neexistuje' });
            return;
        }
        
        const requester = lobby.players.find(p => p.id === socket.id);
        if (!requester || !requester.isHost) {
            console.log('❌ Nemá oprávnění:', requester);
            socket.emit('kickError', { message: 'Nemáš oprávnění vyhazovat hráče' });
            return;
        }
        
        const playerToKick = lobby.players.find(p => p.name === playerName);
        if (!playerToKick) {
            console.log('❌ Hráč nenalezen:', playerName);
            socket.emit('kickError', { message: 'Hráč nenalezen' });
            return;
        }
        
        console.log(`✅ Vyhazuji hráče ${playerName} z lobby ${targetLobbyCode}`);
        
        // Najdi socket vyhozeného hráče
        const kickedSocket = io.sockets.sockets.get(playerToKick.id);
        
        // Vyhoď hráče z lobby objektu
        lobby.players = lobby.players.filter(p => p.name !== playerName);
        
        // Informuj vyhozeného hráče
        if (kickedSocket) {
            kickedSocket.leave(targetLobbyCode);
            kickedSocket.lobbyCode = null;
            kickedSocket.emit('playerKicked', { 
                kickedPlayer: playerName,
                message: 'Byl jsi vyhozen z lobby'
            });
        }
        
        // Informuj všechny ostatní v lobby
        io.to(targetLobbyCode).emit('playerKicked', { 
            kickedPlayer: playerName,
            message: `${playerName} byl vyhozen z lobby`
        });
        
        // Aktualizuj seznam hráčů
        io.to(targetLobbyCode).emit('playersUpdate', lobby.players);
        
        console.log(`✅ Hráč ${playerName} byl úspěšně vyhozen`);
    });

    // Opuštění lobby
    socket.on('leaveLobby', () => {
        if (socket.lobbyCode) {
            const lobby = lobbies.get(socket.lobbyCode);
            if (lobby) {
                // Najdi a odstraň hráče
                const playerIndex = lobby.players.findIndex(player => player.id === socket.id);
                if (playerIndex !== -1) {
                    const leavingPlayer = lobby.players[playerIndex];
                    lobby.players.splice(playerIndex, 1);

                    socket.leave(socket.lobbyCode);
                    socket.to(socket.lobbyCode).emit('playerLeft', { playerName: leavingPlayer.name });

                    // Pokud lobby je prázdné, smaž ho
                    if (lobby.players.length === 0) {
                        lobbies.delete(socket.lobbyCode);
                        console.log(`Lobby ${socket.lobbyCode} bylo smazáno`);
                    } else {
                        // Pokud odešel host, udělej hostem prvního hráče
                        if (leavingPlayer.isHost && lobby.players.length > 0) {
                            lobby.players[0].isHost = true;
                            lobby.host = lobby.players[0].id;
                        }
                        // Pošli aktualizaci ostatním hráčům
                        io.to(socket.lobbyCode).emit('playersUpdate', lobby.players);
                    }

                    console.log(`${leavingPlayer.name} opustil lobby ${socket.lobbyCode}`);
                }
            }
            socket.lobbyCode = null;
        }
    });

    // Začátek hry
    socket.on('startGame', () => {
        if (socket.lobbyCode) {
            const lobby = lobbies.get(socket.lobbyCode);
            if (lobby && lobby.host === socket.id && lobby.players.length >= 2) {
                io.to(socket.lobbyCode).emit('gameStarted');
                console.log(`Hra začala v lobby ${socket.lobbyCode}`);
                
                // Zde později implementuješ herní logiku
            }
        }
    });

    // Odpojení hráče
    socket.on('disconnect', () => {
        console.log('Hráč se odpojil:', socket.id);
        
        // Automaticky opusť lobby při odpojení
        if (socket.lobbyCode) {
            // Simuluj leave lobby
            const lobby = lobbies.get(socket.lobbyCode);
            if (lobby) {
                const playerIndex = lobby.players.findIndex(player => player.id === socket.id);
                if (playerIndex !== -1) {
                    const leavingPlayer = lobby.players[playerIndex];
                    lobby.players.splice(playerIndex, 1);

                    socket.to(socket.lobbyCode).emit('playerLeft', { playerName: leavingPlayer.name });

                    if (lobby.players.length === 0) {
                        lobbies.delete(socket.lobbyCode);
                        console.log(`Lobby ${socket.lobbyCode} bylo smazáno`);
                    } else {
                        if (leavingPlayer.isHost && lobby.players.length > 0) {
                            lobby.players[0].isHost = true;
                            lobby.host = lobby.players[0].id;
                        }
                        io.to(socket.lobbyCode).emit('playersUpdate', lobby.players);
                    }

                    console.log(`${leavingPlayer.name} se odpojil z lobby ${socket.lobbyCode}`);
                }
            }
        }
    });
});

// Debug endpoint pro zobrazení všech lobby
app.get('/debug/lobbies', (req, res) => {
    const lobbiesArray = Array.from(lobbies.entries()).map(([code, lobby]) => ({
        code,
        playerCount: lobby.players.length,
        players: lobby.players.map(p => ({ name: p.name, isHost: p.isHost }))
    }));
    res.json({
        totalLobbies: lobbies.size,
        lobbies: lobbiesArray
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        activeLobbies: lobbies.size
    });
});

// Spuštění serveru
server.listen(PORT, () => {
    console.log(`🚀 Server běží na portu ${PORT}`);
    console.log(`📱 Otevři http://localhost:${PORT} v prohlížeči`);
    console.log(`🔍 Debug info: http://localhost:${PORT}/debug/lobbies`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Server se ukončuje...');
    server.close(() => {
        console.log('Server ukončen.');
    });
});

// Cleanup starých lobby každých 30 minut
setInterval(() => {
    const now = Date.now();
    let removedCount = 0;
    
    lobbies.forEach((lobby, code) => {
        // Odstraň lobby starší než 2 hodiny bez aktivity
        if (!lobby.lastActivity) {
            lobby.lastActivity = now;
        }
        
        if (now - lobby.lastActivity > 2 * 60 * 60 * 1000) { // 2 hodiny
            lobbies.delete(code);
            removedCount++;
            console.log(`🗑️ Odstraněno neaktivní lobby: ${code}`);
        }
    });
    
    if (removedCount > 0) {
        console.log(`🧹 Cleanup dokončen: odstraněno ${removedCount} lobby`);
    }
}, 30 * 60 * 1000); // každých 30 minut