"use strict";
const moduleName = "tic_tac_toe";
// Op codes for messages between client and server
const OpCode = {
    MOVE: 1,
    GAME_STATE: 2,
    GAME_OVER: 3,
    START: 4,
};
const matchInit = function (ctx, logger, nk, params) {
    const state = {
        board: ["", "", "", "", "", "", "", "", ""],
        marks: {},
        turn: "",
        players: [],
        winner: null,
        gameOver: false,
    };
    return {
        state,
        tickRate: 1,
        label: "tic_tac_toe",
    };
};
const matchJoinAttempt = function (ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
    const mState = state;
    if (mState.players.length >= 2) {
        return { state, accept: false, rejectMessage: "Match is full" };
    }
    return { state, accept: true };
};
const matchJoin = function (ctx, logger, nk, dispatcher, tick, state, presences) {
    const mState = state;
    for (const presence of presences) {
        mState.players.push(presence.userId);
        mState.marks[presence.userId] = mState.players.length === 1 ? "X" : "O";
    }
    if (mState.players.length === 2) {
        mState.turn = mState.players[0];
        dispatcher.broadcastMessage(OpCode.START, JSON.stringify({
            board: mState.board,
            marks: mState.marks,
            turn: mState.turn,
        }));
    }
    return { state: mState };
};
const matchLeave = function (ctx, logger, nk, dispatcher, tick, state, presences) {
    const mState = state;
    for (const presence of presences) {
        const index = mState.players.indexOf(presence.userId);
        if (index !== -1) {
            mState.players.splice(index, 1);
        }
    }
    // If a player leaves mid-game, end the match
    if (!mState.gameOver && mState.players.length < 2) {
        mState.gameOver = true;
        dispatcher.broadcastMessage(OpCode.GAME_OVER, JSON.stringify({
            winner: mState.players[0] || null,
            reason: "opponent_left",
        }));
    }
    return { state: mState };
};
const matchLoop = function (ctx, logger, nk, dispatcher, tick, state, messages) {
    const mState = state;
    if (mState.gameOver && mState.players.length === 0) {
        return null;
    }
    for (const message of messages) {

        if (message.opCode !== OpCode.MOVE)
            continue;

        if (mState.gameOver || mState.players.length < 2)
            continue;

        if (message.sender.userId !== mState.turn)
            continue;
        const data = JSON.parse(nk.binaryToString(message.data));
        const position = data.position;

        if (position < 0 || position > 8)
            continue;
        if (mState.board[position] !== "")
            continue;

        const mark = mState.marks[message.sender.userId];
        mState.board[position] = mark;

        const winner = checkWinner(mState.board);
        const isDraw = !winner && mState.board.every(cell => cell !== "");
        if (winner || isDraw) {
            mState.gameOver = true;
            mState.winner = winner ? message.sender.userId : null;

            if (winner) {
                nk.leaderboardRecordWrite("tictactoe_wins", message.sender.userId, message.sender.username, 1);
            }
            dispatcher.broadcastMessage(OpCode.GAME_OVER, JSON.stringify({
                board: mState.board,
                winner: mState.winner,
                winnerMark: winner,
                isDraw,
            }));
        }
        else {

            mState.turn = mState.players.find(p => p !== message.sender.userId);
            dispatcher.broadcastMessage(OpCode.GAME_STATE, JSON.stringify({
                board: mState.board,
                turn: mState.turn,
            }));
        }
    }
    return { state: mState };
};
const matchTerminate = function (ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
    return { state };
};
const matchSignal = function (ctx, logger, nk, dispatcher, tick, state) {
    return { state };
};

function checkWinner(board) {
    const lines = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],
        [0, 3, 6], [1, 4, 7], [2, 5, 8],
        [0, 4, 8], [2, 4, 6],
    ];
    for (const [a, b, c] of lines) {
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a];
        }
    }
    return null;
}
// Register the match handler
var InitModule = function (ctx, logger, nk, initializer) {
    initializer.registerMatch(moduleName, {
        matchInit,
        matchJoinAttempt,
        matchJoin,
        matchLeave,
        matchLoop,
        matchTerminate,
        matchSignal,
    });
    try {
        nk.leaderboardCreate("tictactoe_wins", false, "descending" /* nkruntime.SortOrder.DESCENDING */, "increment" /* nkruntime.Operator.INCREMENTAL */);
    }
    catch (e) {
        // Already exists, ignore
    }
    logger.info("Tic Tac Toe module loaded!");
};
