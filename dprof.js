'use strict';

const asyncHook = require('async-hook');
const chain = require('stack-chain');
const zlib = require('zlib');
const fs = require('fs');

const version = require('./package.json').version;
const processStart = process.hrtime();

// Change the default stackTraceLimit if it haven't allready been overwritten
if (process.execArgv.indexOf('--stack_trace_limit') === -1 && Error.stackTraceLimit === 10) {
  Error.stackTraceLimit = 8;
}

//
// Define node class
//

function Site(site) {
  this.description = site.toString();
  this.filename = site.getFileName();
  this.line = site.getLineNumber();
  this.collum = site.getColumnNumber();
}

function timestamp() {
  const t = process.hrtime(processStart);
  return t[0] * 1e9 + t[1];
}

function Node(handle, stack) {
  this.name = handle.constructor.name;
  this._init = timestamp();
  this._destroy = Infinity;
  this._before = [];
  this._after = [];
  this.unrefed = this.name === 'TTY' || this.name === 'Pipe';
  this.children = [];
  this.stack = stack.map(function (site) {
    return new Site(site);
  });

  asyncHook.disable();
  if (!this.unrefed && typeof handle.hasRef === 'function') {
    process.nextTick(() => {
      this.unrefed = !handle.hasRef();
    });
  }
  asyncHook.enable();
}

function getCallSites(skip) {
  const limit = Error.stackTraceLimit;

  Error.stackTraceLimit = limit + skip;
  const stack = chain.callSite({
    extend: false,
    filter: true,
    slice: skip
  });
  Error.stackTraceLimit = limit;

  return stack;
}

Node.prototype.add = function (handle) {
  const node = new Node(handle, getCallSites(3));
  this.children.push(node);
  return node;
};

Node.prototype.before = function () {
  this._before.push(timestamp());
};

Node.prototype.after = function () {
  this._after.push(timestamp());
};

Node.prototype.destroy = function () {
  this._destroy = timestamp();
};

Node.prototype.toJSON = function () {
  return {
    name: this.name,
    init: this._init,
    destroy: this._destroy,
    before: this._before,
    after: this._after,
    unrefed: this.unrefed,
    stack: this.stack,
    children: this.children
  };
};

Node.prototype.rootIntialize = function () {
  this._init = 0;
  this._before.push(0);
};

//
// Setup hooks
//
asyncHook.addHooks({
  init: asyncInit,
  pre: asyncBefore,
  post: asyncAfter,
  destroy: asyncDestroy
});

const root = new Node({ constructor: { name: 'root' } }, getCallSites(2));
      root.rootIntialize();

const stateMap = new Map();
let currState = root;

function asyncInit(uid, handle, provider, parentUid) {
  // get parent state
  const state = (parentUid === null ? currState : stateMap.get(parentUid));

  // add new state node
  stateMap.set(uid, state.add(handle));
}

function asyncBefore(uid) {
  const state = stateMap.get(uid);

  state.before();
  currState = state;
}

function asyncAfter(uid) {
  const state = stateMap.get(uid);

  state.after();
  currState = root;
}

function asyncDestroy(uid) {
  const state = stateMap.get(uid);

  state.destroy();
  stateMap.delete(uid);
}

// The root job is done when process.nextTick is called
asyncHook.disable();
process.nextTick(function () {
  root.after();
  root.destroy();
});
asyncHook.enable();

//
// Print result
//

if (process.argv.indexOf('--dprof-no-sigint') === -1 &&
    !process.env.hasOwnProperty('DPROF_NO_SIGINT')) {
  process.on('SIGINT', function handleSIGINT() {
    writeDataFile();

    // Trigger node's default handler
    process.removeAllListeners('SIGINT');
    process.kill(process.pid, 'SIGINT');
  });
}

process.on('exit', writeDataFile);

function writeDataFile() {
  // even though zlib is sync, it still fires async_wrap events,
  // so disable asyncWrap just to be sure.
  asyncHook.disable();

  const data = {
    'total': timestamp(),
    'version': version,
    'root': root
  };

  if (process.env.NODE_DPROF_DEBUG) {
    fs.writeFileSync('./dprof.json', JSON.stringify(data, null, 1));
  } else {
    fs.writeFileSync('./dprof.json.gz', zlib.gzipSync(JSON.stringify(data)));
  }
}
