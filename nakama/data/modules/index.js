"use strict";
var moduleName = "tic_tac_toe";
// Op codes for messages between client and server
var OpCode = {
    MOVE: 1,
    GAME_STATE: 2,
    GAME_OVER: 3,
    START: 4,
};
var matchInit = function (ctx, logger, nk, params) {
    var state = {
        board: ["", "", "", "", "", "", "", "", ""],
        marks: {},
        turn: "",
        players: [],
        winner: null,
        gameOver: false,
    };
    return {
        state: state,
        tickRate: 1,
        label: "tic_tac_toe",
    };
};
var matchJoinAttempt = function (ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
    var mState = state;
    if (mState.players.length >= 2) {
        return { state: state, accept: false, rejectMessage: "Match is full" };
    }
    return { state: state, accept: true };
};
var matchJoin = function (ctx, logger, nk, dispatcher, tick, state, presences) {
    var mState = state;
    for (var _i = 0, presences_1 = presences; _i < presences_1.length; _i++) {
        var presence = presences_1[_i];
        if (mState.players.indexOf(presence.userId) === -1) {
            var mark = mState.players.length === 0 ? "X" : "O";
            mState.players.push(presence.userId);
            mState.marks[presence.userId] = mark;
            logger.info("Player joined: " + presence.userId + " as " + mark);
        }
    }
    logger.info("Total players: " + mState.players.length);
    if (mState.players.length === 2) {
        mState.turn = mState.players[0];
        logger.info("Game starting! Broadcasting START");
        dispatcher.broadcastMessage(OpCode.START, JSON.stringify({
            board: mState.board,
            marks: mState.marks,
            turn: mState.turn,
        }));
    }
    return { state: mState };
};
var matchLeave = function (ctx, logger, nk, dispatcher, tick, state, presences) {
    var mState = state;
    for (var _i = 0, presences_2 = presences; _i < presences_2.length; _i++) {
        var presence = presences_2[_i];
        var index = mState.players.indexOf(presence.userId);
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
var matchLoop = function (ctx, logger, nk, dispatcher, tick, state, messages) {
    var mState = state;
    if (mState.gameOver && mState.players.length === 0) {
        return null;
    }
    var _loop_1 = function (message) {
        if (message.opCode === 99) {
            dispatcher.broadcastMessage(OpCode.START, JSON.stringify({
                board: mState.board,
                turn: mState.turn,
                marks: mState.marks,
            }));
            return "continue";
        }
        if (message.opCode !== OpCode.MOVE)
            return "continue";
        logger.info("MOVE received from: " + message.sender.userId);
        logger.info("Current turn: " + mState.turn);
        logger.info("Game over: " + mState.gameOver);
        logger.info("Players count: " + mState.players.length);
        if (mState.gameOver || mState.players.length < 2) {
            logger.info("Skipping - game over or not enough players");
            return "continue";
        }
        if (message.sender.userId !== mState.turn) {
            logger.info("Skipping - not this player's turn");
            return "continue";
        }
        var data = JSON.parse(nk.binaryToString(message.data));
        var position = data.position;
        logger.info("Position: " + position);
        logger.info("Cell value: " + mState.board[position]);
        if (position < 0 || position > 8)
            return "continue";
        if (mState.board[position] !== "")
            return "continue";
        var mark = mState.marks[message.sender.userId];
        mState.board[position] = mark;
        logger.info("Board: " + JSON.stringify(mState.board));
        var winner = checkWinner(mState.board);
        var isDraw = !winner && mState.board.every(function (cell) { return cell !== ""; });
        logger.info("Winner: " + winner + " isDraw: " + isDraw);
        if (winner || isDraw) {
            mState.gameOver = true;
            mState.winner = winner ? message.sender.userId : null;
            if (winner) {
                try {
                    nk.leaderboardRecordWrite("tictactoe_wins", message.sender.userId, message.sender.username, 1);
                }
                catch (e) {
                    logger.warn("Leaderboard write failed: " + e);
                }
            }
            logger.info("Broadcasting GAME_OVER");
            dispatcher.broadcastMessage(OpCode.GAME_OVER, JSON.stringify({
                board: mState.board,
                winner: mState.winner,
                winnerMark: winner,
                isDraw: isDraw,
            }));
        }
        else {
            mState.turn = mState.players.find(function (p) { return p !== message.sender.userId; });
            dispatcher.broadcastMessage(OpCode.GAME_STATE, JSON.stringify({
                board: mState.board,
                turn: mState.turn,
                marks: mState.marks,
            }));
        }
    };
    for (var _i = 0, messages_1 = messages; _i < messages_1.length; _i++) {
        var message = messages_1[_i];
        _loop_1(message);
    }
    return { state: mState };
};
var matchTerminate = function (ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
    return { state: state };
};
var matchSignal = function (ctx, logger, nk, dispatcher, tick, state) {
    return { state: state };
};
// Check winner helper
function checkWinner(board) {
    var lines = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],
        [0, 3, 6], [1, 4, 7], [2, 5, 8],
        [0, 4, 8], [2, 4, 6],
    ];
    for (var _i = 0, lines_1 = lines; _i < lines_1.length; _i++) {
        var _a = lines_1[_i], a = _a[0], b = _a[1], c = _a[2];
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a];
        }
    }
    return null;
}
var matchmakerMatched = function (ctx, logger, nk, matches) {
    logger.info("Matchmaker matched! Creating match for " + matches.length + " players");
    var matchId = nk.matchCreate("tic_tac_toe", {});
    logger.info("Match created: " + matchId);
    return matchId;
};
// Register the match handler
var InitModule = function (ctx, logger, nk, initializer) {
    initializer.registerMatch(moduleName, {
        matchInit: matchInit,
        matchJoinAttempt: matchJoinAttempt,
        matchJoin: matchJoin,
        matchLeave: matchLeave,
        matchLoop: matchLoop,
        matchTerminate: matchTerminate,
        matchSignal: matchSignal,
    });
    initializer.registerMatchmakerMatched(matchmakerMatched);
    try {
        nk.leaderboardCreate("tictactoe_wins", false, "descending" /* nkruntime.SortOrder.DESCENDING */, "INCREMENT" /* nkruntime.Operator.INCREMENT */);
    }
    catch (e) {
        // Already exists
    }
    logger.info("Tic Tac Toe module loaded!");
};
