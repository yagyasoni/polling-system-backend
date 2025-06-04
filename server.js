const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "polling-system-frontend-assignment-c6kqqtlub.vercel.app", // Your React app's origin
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

let activePoll = null;
let pollResults = {};
let pollVotesByStudent = {};

// API to create a new poll (Teacher)
app.post('/api/polls', (req, res) => {
    const { question, options, durationSeconds } = req.body;

    // --- CRITICAL FIX: Ensure durationSeconds is always a valid number ---
    let parsedDurationSeconds = parseInt(durationSeconds, 10);
    // If parsedDurationSeconds is NaN (from undefined, null, or non-numeric string) or less than 5,
    // default to 60 seconds (or a minimum of 5 seconds if explicitly set lower).
    if (isNaN(parsedDurationSeconds) || parsedDurationSeconds < 5) {
        parsedDurationSeconds = 60; // Default to 60 seconds if invalid or too low
        console.warn(`[SERVER] Received invalid or low durationSeconds (${durationSeconds}). Defaulting to ${parsedDurationSeconds}s.`);
    }

    activePoll = {
        id: Date.now().toString(),
        question,
        options: options.map((opt, index) => ({ id: index, text: opt })),
        durationSeconds: parsedDurationSeconds, // Use the validated duration
    };
    pollResults = activePoll.options.reduce((acc, opt) => ({ ...acc, [opt.id]: 0 }), {});
    pollVotesByStudent[activePoll.id] = {};

    console.log(`[SERVER] New poll created: "${activePoll.question}", Duration: ${activePoll.durationSeconds}s`);
    io.emit('newPoll', activePoll);

    res.status(201).json({ message: 'Poll created and broadcasted', poll: activePoll });
});

io.on('connection', (socket) => {
    console.log(`[SERVER] A user connected: ${socket.id}`);

    if (activePoll) {
        console.log(`[SERVER] New connection: Sending existing poll to ${socket.id}: ${activePoll.question}`);
        socket.emit('newPoll', activePoll);
        socket.emit('updateResults', calculatePercentages(pollResults, activePoll));
    }

    socket.on('submitAnswer', (data) => {
        const { pollId, optionId, studentName } = data;
        console.log(`[SERVER] Answer attempt from ${studentName} for poll ${pollId}`);

        if (activePoll && activePoll.id === pollId) {
            if (pollVotesByStudent[pollId] && pollVotesByStudent[pollId][studentName]) {
                console.warn(`[SERVER] Student ${studentName} already voted for poll ${pollId}. Ignoring duplicate.`);
                socket.emit('alreadyVoted', { pollId: pollId, message: 'You have already voted in this poll.' });
                return;
            }

            const isValidOption = activePoll.options.some(opt => opt.id === optionId);
            if (isValidOption) {
                 if (typeof pollResults[optionId] === 'undefined') {
                    pollResults[optionId] = 0;
                }
                pollResults[optionId]++;
                pollVotesByStudent[pollId][studentName] = true;

                console.log(`[SERVER] Answer received from ${studentName} for poll ${pollId}, option ${optionId}. Current results:`, pollResults);
                io.emit('updateResults', calculatePercentages(pollResults, activePoll));
            } else {
                console.warn(`[SERVER] Invalid optionId ${optionId} received for poll ${pollId}`);
            }
        } else {
            console.warn(`[SERVER] Answer received for non-existent or wrong pollId: ${pollId}`);
            socket.emit('pollEnded', { pollId: pollId, message: 'This poll is no longer active.' });
        }
    });

    socket.on('disconnect', () => {
        console.log(`[SERVER] User disconnected: ${socket.id}`);
    });
});

function calculatePercentages(results, currentActivePoll) {
    const totalVotes = Object.values(results).reduce((sum, count) => sum + count, 0);
    if (!currentActivePoll || !currentActivePoll.options) return [];
    if (totalVotes === 0) {
        return currentActivePoll.options.map(opt => ({ optionId: opt.id, percentage: 0 }));
    }
    return currentActivePoll.options.map(opt => {
        const votesForOption = results[opt.id] || 0;
        return { optionId: opt.id, percentage: (votesForOption / totalVotes) * 100 };
    });
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
