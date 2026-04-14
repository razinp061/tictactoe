const moduleName = "tic_tac_toe";

// Op codes for messages between client and server
const OpCode = {
  MOVE: 1,
  GAME_STATE: 2,
  GAME_OVER: 3,
  START: 4,
};

// Initial match state
interface MatchState {
  board: string[];
  marks: {[userId: string]: string};
  turn: string;
  players: string[];
  winner: string | null;
  gameOver: boolean;
}

const matchInit: nkruntime.MatchInitFunction = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  params: {[key: string]: string}
): {state: nkruntime.MatchState; tickRate: number; label: string} {
  const state: MatchState = {
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

const matchJoinAttempt: nkruntime.MatchJoinAttemptFunction = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  presence: nkruntime.Presence,
  metadata: {[key: string]: any}
): {state: nkruntime.MatchState; accept: boolean; rejectMessage?: string} {
  const mState = state as MatchState;

  if (mState.players.length >= 2) {
    return { state, accept: false, rejectMessage: "Match is full" };
  }

  return { state, accept: true };
};

const matchJoin: nkruntime.MatchJoinFunction = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  presences: nkruntime.Presence[]
): {state: nkruntime.MatchState} | null {
  const mState = state as MatchState;

  for (const presence of presences) {
    if (mState.players.indexOf(presence.userId) === -1) {
      const mark = mState.players.length === 0 ? "X" : "O";
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

const matchLeave: nkruntime.MatchLeaveFunction = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  presences: nkruntime.Presence[]
): {state: nkruntime.MatchState} | null {
  const mState = state as MatchState;

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

const matchLoop: nkruntime.MatchLoopFunction = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  messages: nkruntime.MatchMessage[]
): {state: nkruntime.MatchState} | null {
  const mState = state as MatchState;

  if (mState.gameOver && mState.players.length === 0) {
    return null;
  }

  for (const message of messages) {
    if (message.opCode === 99) {
      dispatcher.broadcastMessage(OpCode.START, JSON.stringify({
        board: mState.board,
        turn: mState.turn,
        marks: mState.marks,
      }));
      continue;
    }

    if (message.opCode !== OpCode.MOVE) continue;

    logger.info("MOVE received from: " + message.sender.userId);
    logger.info("Current turn: " + mState.turn);
    logger.info("Game over: " + mState.gameOver);
    logger.info("Players count: " + mState.players.length);

    if (mState.gameOver || mState.players.length < 2) {
      logger.info("Skipping - game over or not enough players");
      continue;
    }

    if (message.sender.userId !== mState.turn) {
      logger.info("Skipping - not this player's turn");
      continue;
    }

    const data = JSON.parse(nk.binaryToString(message.data));
    const position: number = data.position;

    logger.info("Position: " + position);
    logger.info("Cell value: " + mState.board[position]);

    if (position < 0 || position > 8) continue;
    if (mState.board[position] !== "") continue;

    const mark = mState.marks[message.sender.userId];
    mState.board[position] = mark;

    logger.info("Board: " + JSON.stringify(mState.board));

    const winner = checkWinner(mState.board);
    const isDraw = !winner && mState.board.every(cell => cell !== "");

    logger.info("Winner: " + winner + " isDraw: " + isDraw);

    if (winner || isDraw) {
      mState.gameOver = true;
      mState.winner = winner ? message.sender.userId : null;

      if (winner) {
  try {
    nk.leaderboardRecordWrite("tictactoe_wins", message.sender.userId, message.sender.username, 1);
  } catch (e) {
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
    } else {
      mState.turn = mState.players.find(p => p !== message.sender.userId)!;

      dispatcher.broadcastMessage(OpCode.GAME_STATE, JSON.stringify({
        board: mState.board,
        turn: mState.turn,
        marks: mState.marks,
      }));
    }
  }

  return { state: mState };
};

const matchTerminate: nkruntime.MatchTerminateFunction = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  graceSeconds: number
): {state: nkruntime.MatchState} | null {
  return { state };
};

const matchSignal: nkruntime.MatchSignalFunction = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState
): {state: nkruntime.MatchState; data?: string} | null {
  return { state };
};

function checkWinner(board: string[]): string | null {
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
const matchmakerMatched: nkruntime.MatchmakerMatchedFunction = function(ctx, logger, nk, matches) {
  logger.info("Matchmaker matched! Creating match for " + matches.length + " players");
  const matchId = nk.matchCreate("tic_tac_toe", {});
  logger.info("Match created: " + matchId);
  return matchId;
};

// Register the match handler
var InitModule: nkruntime.InitModule = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  initializer: nkruntime.Initializer
): Error | void {
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
    nk.leaderboardCreate("tictactoe_wins", false, nkruntime.SortOrder.DESCENDING, nkruntime.Operator.INCREMENT);
  } catch (e) {
    // Already exists
  }

  logger.info("Tic Tac Toe module loaded!");
};