(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){

  //Loading libraries
  var AWS = require('aws-sdk');
  var AWSIoTData = require('aws-iot-device-sdk');
  var EventEmitter = require('events');




  //
  // Configuration of the AWS SDK.
  //

  /*
   * The awsConfiguration object is used to store the credentials
   * to connect to AWS service.
   * MAKE SHURE to insert the correct name for your endpoint,
   * the correct Cognito PoolID and the correct AWS region.
   */
  var AWSConfiguration = {
    poolId: 'us-east-1:b77e9685-4a3c-4306-a929-e440fb47df86',
    host: "a29wnmzjyb35x8-ats.iot.us-east-1.amazonaws.com",
    region: 'us-east-1'
  };

  function getCookie(cname) {
    var name = cname + "=";
    var decodedCookie = decodeURIComponent(document.cookie);
    var ca = decodedCookie.split(';');
    for(var i = 0; i <ca.length; i++) {
      var c = ca[i];
      while (c.charAt(0) == ' ') {
        c = c.substring(1);
      }
      if (c.indexOf(name) == 0) {
        return c.substring(name.length, c.length);
      }
    }
    return "";
  }

  //The id of the MQTT client.
  var clientId = getCookie("clientId");
  if (clientId == "") {
    clientId = 'EdgeSmartphone-' + (Math.floor((Math.random() * 100000) + 1));
    document.cookie = "clientId="+clientId;
  }


  AWS.config.region = AWSConfiguration.region;
  AWS.config.credentials = new AWS.CognitoIdentityCredentials({
    IdentityPoolId: AWSConfiguration.poolId
  });

  //The mqttClient object used for retrieving the messages from the MQTT server.
  const mqttClient = AWSIoTData.device({
    region: AWS.config.region, //Set the AWS region we will operate in
    host: AWSConfiguration.host, //Set the AWS IoT Host Endpoint
    clientId: clientId, //The clientId created earlier
    protocol: 'wss', //Connect via secure WebSocket
    maximumReconnectTimeMs: 8000, //Set the maximum reconnect time to 8 seconds
    debug: true, //Enable console debugging information
    accessKeyId: '',
    secretKey: '',
    sessionToken: ''
  });


  //The cognitoIdentity used for authentication.
  var cognitoIdentity = new AWS.CognitoIdentity();
  AWS.config.credentials.get(function(err, data) {
    if (!err) {
      console.log('retrieved identity: ' + AWS.config.credentials.identityId);
      var params = {
        IdentityId: AWS.config.credentials.identityId
      };
      cognitoIdentity.getCredentialsForIdentity(params, function(err, data) {
        if (!err) {
          mqttClient.updateWebSocketCredentials(data.Credentials.AccessKeyId,
            data.Credentials.SecretKey,
            data.Credentials.SessionToken);
        } else {
          console.log('error retrieving credentials: ' + err);
          alert('error retrieving credentials: ' + err);
        }
      });
    } else {
      console.log('error retrieving identity:' + err);
      alert('error retrieving identity: ' + err);
    }
  });


  //Connect handler: once the MQTT client has successfully connected
  //to the MQTT server it starts publishing
  function mqttClientConnectHandler() {
    console.log('connected to MQTT server');
    slidingWindowAnalizer.on("statusChanged", function(){
      mqttClient.publish('EdgeComputing/'+clientId, JSON.stringify({status:this.status}));
      console.log("publishing " + JSON.stringify({status:this.status}));
    });
  };

  mqttClient.on('connect', mqttClientConnectHandler);


  //
  // retrieving sensors data
  //

  var accData = {x:0, y:0, z:0};
  var samplingFrequency = 2;

  function createMedianFilter(length) {
    var buffer   = new Float64Array(length)
    var history  = new Int32Array(length)
    var counter  = 0
    var bufCount = 0
    function insertItem(x) {
      var nextCounter = counter++
      var oldCounter  = nextCounter - length

      //First pass:  Remove all old items
      var ptr = 0
      for(var i=0; i<bufCount; ++i) {
        var c = history[i]
        if(c <= oldCounter) {
          continue
        }
        buffer[ptr] = buffer[i]
        history[ptr] = c
        ptr += 1
      }
      bufCount = ptr

      //Second pass:  Insert x
      if(!isNaN(x)) {
        var ptr = bufCount
        for(var j=bufCount-1; j>=0; --j) {
          var y = buffer[j]
          if(y < x) {
            buffer[ptr] = x
            history[ptr] = nextCounter
            break
          }
          buffer[ptr] = y
          history[ptr] = history[j]
          ptr -= 1
        }
        if(j < 0) {
          buffer[0]  = x
          history[0] = nextCounter
        }
        bufCount += 1
      }

      //Return median
      if(!bufCount) {
        return NaN
      } else if(bufCount & 1) {
        return buffer[bufCount>>>1]
      } else {
        var mid = bufCount>>>1
        return 0.5*(buffer[mid-1] + buffer[mid])
      }
    }
    return insertItem
  }
  function createCombinedMedianFilter(length){
    var medianX = createMedianFilter(length);
    var medianY = createMedianFilter(length);
    var medianZ = createMedianFilter(length);

    function insertData(d){
      var x = medianX(d.x);
      var y = medianX(d.y);
      var z = medianX(d.z);

      return {x:x, y:y, z:z};
    }

    return insertData;
  }
  function createLowPassFilter(cutoff, sampleRate) {
    var rc = 1.0 / (cutoff * 2 * Math.PI);
    var dt = 1.0 / sampleRate;
    var alpha = dt / (rc + dt);

    var previous;

    function filterItem(d){
      if (previous == undefined){
        previous = d;
        return d;
      } else {
        var next = {
          x: previous.x + (alpha * (d.x - previous.x)),
          y: previous.y + (alpha * (d.y - previous.y)),
          z: previous.z + (alpha * (d.z - previous.z))
        }
        previous = next;
        return next;
      }
    }

    return filterItem;
  }
  function createHighPassFilter(cutoff, sampleRate) {
    var rc = 1.0 / (cutoff * 2 * Math.PI);
    var dt = 1.0 / sampleRate;
    var alpha = rc / (rc + dt);

    var previousFiltered;
    var previousSample;

    function insertItem(d){
      if (previousFiltered == undefined){
        previousFiltered = d;
        previousSample = d;
        return d;
      } else {
        var next = {
          x: alpha * (previousFiltered.x + d.x -previousSample.x),
          y: alpha * (previousFiltered.y + d.y -previousSample.y),
          z: alpha * (previousFiltered.z + d.z -previousSample.z)
        }

        previousFiltered = next;
        previousSample = d;
        return next;
      }
    }

    return insertItem;
  }
  class SlidingWindowAnalizer extends EventEmitter {
    constructor(windowSize) {
      super();
      this.windowSize = windowSize;
      this.window = [];
      this.status = "Resting";
    }

    insertItem(d){
      this.window.push(d);
      if(this.window.length == this.windowSize){
        var average = 0;
        for(var i=0; i<this.window.length; i++){
          average += Math.abs(this.window[i].x)
                   + Math.abs(this.window[i].y)
                   + Math.abs(this.window[i].z);
        }

        average = average/(this.windowSize);

        console.log(average);

        if (average > 0.8 && this.status == "Resting"){
          this.status = "Moving";
          this.emit('statusChanged');
        } else if (average <= 0.8 && this.status == "Moving") {
          this.status = "Resting";
          this.emit('statusChanged');
        }

        this.window.splice(0, this.windowSize/2);
      }
      return this.status;
    }
  }

  var medianFilter = createCombinedMedianFilter(samplingFrequency);
  var lowPassFilter = createLowPassFilter(20, samplingFrequency);
  var highPassFilter = createHighPassFilter(0.3, samplingFrequency);


  var slidingWindowAnalizer = new SlidingWindowAnalizer(samplingFrequency*3);



  function analizeData() {
    var filteredData = highPassFilter(lowPassFilter(medianFilter(accData)));
    slidingWindowAnalizer.insertItem(filteredData);
  }

  function startDeviceMotionAccelerometer() {
    document.getElementById("SensorRequestBanner").style.display = "none";
    window.addEventListener('devicemotion', function(e) {
      accData.x = e.accelerationIncludingGravity.x;
      accData.y = e.accelerationIncludingGravity.y;
      accData.z = e.accelerationIncludingGravity.z;
    });

    setInterval(analizeData, 1000/samplingFrequency);
    slidingWindowAnalizer.on("statusChanged", function(){
      document.getElementById('status').innerHTML = this.status;
    });
  }

  function startSensorAPIAccelerometer() {
    navigator.permissions.query({ name: 'accelerometer' })
    .then(result => {
      if (result.state === 'denied') {
        accelerometerNotAllowed();
      } else {
        document.getElementById("SensorRequestBanner").style.display = "none";
        let sensor = new Accelerometer();
        sensor.addEventListener('reading', function(e) {
          accData.x = e.target.x;
          accData.y = e.target.y;
          accData.z = e.target.z;
        });
        sensor.start();

        setInterval(analizeData, 1000/samplingFrequency);
        slidingWindowAnalizer.on("statusChanged", function(){
          document.getElementById('status').innerHTML = this.status;
        });
      }
    });
  }

  function requestDeviceMotionPermission() {
    window.DeviceMotionEvent.requestPermission()
      .then(response => {
        if (response === 'granted') {
          startDeviceMotionAccelerometer();
        } else {
          accelerometerNotAllowed();
        }
      })
      .catch(e => {
        console.error(e);
        accelerometerNotAllowed();
      })
  }

  function accelerometerNotAllowed() {
    var errorBanner = "<div id='ErrorBanner' class='Banner'>"
                    + "<h3>Ops..</h3>"
                    + "<p>The app requires access to the accelerometer to work</p>"
                    + "<div>"

    document.getElementById("content").innerHTML = errorBanner;
  }

  function noAccelerometer() {
    var errorBanner = "<div id='ErrorBanner' class='Banner'>"
                    + "<h3>Ops..</h3>"
                    + "<p>Your device doesn't have an accelerometer</p>"
                    + "<div>"

    document.getElementById("content").innerHTML = errorBanner;
  }

  window.onload = function() {
    if ('Accelerometer' in window) {
      //android
      document.getElementById("enableButton").onclick = startSensorAPIAccelerometer;
      document.getElementById("cancelButton").onclick = accelerometerNotAllowed;
      document.getElementById("SensorRequestBanner").style.display = "block";

    } else if (window.DeviceMotionEvent) {
      //ios
      if (typeof window.DeviceMotionEvent.requestPermission === 'function') {
        //ios 13
        document.getElementById("enableButton").onclick = requestDeviceMotionPermission;
        document.getElementById("cancelButton").onclick = accelerometerNotAllowed;
        document.getElementById("SensorRequestBanner").style.display = "block";
      } else {
        //older version of ios, no need for permission
        document.getElementById("enableButton").onclick = startSensorAPIAccelerometer;
        document.getElementById("cancelButton").onclick = accelerometerNotAllowed;
        document.getElementById("SensorRequestBanner").style.display = "block";
      }
    } else {
      noAccelerometer();
    }
  }


},{"aws-iot-device-sdk":"aws-iot-device-sdk","aws-sdk":"aws-sdk","events":2}],2:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var objectCreate = Object.create || objectCreatePolyfill
var objectKeys = Object.keys || objectKeysPolyfill
var bind = Function.prototype.bind || functionBindPolyfill

function EventEmitter() {
  if (!this._events || !Object.prototype.hasOwnProperty.call(this, '_events')) {
    this._events = objectCreate(null);
    this._eventsCount = 0;
  }

  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
var defaultMaxListeners = 10;

var hasDefineProperty;
try {
  var o = {};
  if (Object.defineProperty) Object.defineProperty(o, 'x', { value: 0 });
  hasDefineProperty = o.x === 0;
} catch (err) { hasDefineProperty = false }
if (hasDefineProperty) {
  Object.defineProperty(EventEmitter, 'defaultMaxListeners', {
    enumerable: true,
    get: function() {
      return defaultMaxListeners;
    },
    set: function(arg) {
      // check whether the input is a positive number (whose value is zero or
      // greater and not a NaN).
      if (typeof arg !== 'number' || arg < 0 || arg !== arg)
        throw new TypeError('"defaultMaxListeners" must be a positive number');
      defaultMaxListeners = arg;
    }
  });
} else {
  EventEmitter.defaultMaxListeners = defaultMaxListeners;
}

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
  if (typeof n !== 'number' || n < 0 || isNaN(n))
    throw new TypeError('"n" argument must be a positive number');
  this._maxListeners = n;
  return this;
};

function $getMaxListeners(that) {
  if (that._maxListeners === undefined)
    return EventEmitter.defaultMaxListeners;
  return that._maxListeners;
}

EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
  return $getMaxListeners(this);
};

// These standalone emit* functions are used to optimize calling of event
// handlers for fast cases because emit() itself often has a variable number of
// arguments and can be deoptimized because of that. These functions always have
// the same number of arguments and thus do not get deoptimized, so the code
// inside them can execute faster.
function emitNone(handler, isFn, self) {
  if (isFn)
    handler.call(self);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self);
  }
}
function emitOne(handler, isFn, self, arg1) {
  if (isFn)
    handler.call(self, arg1);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1);
  }
}
function emitTwo(handler, isFn, self, arg1, arg2) {
  if (isFn)
    handler.call(self, arg1, arg2);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1, arg2);
  }
}
function emitThree(handler, isFn, self, arg1, arg2, arg3) {
  if (isFn)
    handler.call(self, arg1, arg2, arg3);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1, arg2, arg3);
  }
}

function emitMany(handler, isFn, self, args) {
  if (isFn)
    handler.apply(self, args);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].apply(self, args);
  }
}

EventEmitter.prototype.emit = function emit(type) {
  var er, handler, len, args, i, events;
  var doError = (type === 'error');

  events = this._events;
  if (events)
    doError = (doError && events.error == null);
  else if (!doError)
    return false;

  // If there is no 'error' event listener then throw.
  if (doError) {
    if (arguments.length > 1)
      er = arguments[1];
    if (er instanceof Error) {
      throw er; // Unhandled 'error' event
    } else {
      // At least give some kind of context to the user
      var err = new Error('Unhandled "error" event. (' + er + ')');
      err.context = er;
      throw err;
    }
    return false;
  }

  handler = events[type];

  if (!handler)
    return false;

  var isFn = typeof handler === 'function';
  len = arguments.length;
  switch (len) {
      // fast cases
    case 1:
      emitNone(handler, isFn, this);
      break;
    case 2:
      emitOne(handler, isFn, this, arguments[1]);
      break;
    case 3:
      emitTwo(handler, isFn, this, arguments[1], arguments[2]);
      break;
    case 4:
      emitThree(handler, isFn, this, arguments[1], arguments[2], arguments[3]);
      break;
      // slower
    default:
      args = new Array(len - 1);
      for (i = 1; i < len; i++)
        args[i - 1] = arguments[i];
      emitMany(handler, isFn, this, args);
  }

  return true;
};

function _addListener(target, type, listener, prepend) {
  var m;
  var events;
  var existing;

  if (typeof listener !== 'function')
    throw new TypeError('"listener" argument must be a function');

  events = target._events;
  if (!events) {
    events = target._events = objectCreate(null);
    target._eventsCount = 0;
  } else {
    // To avoid recursion in the case that type === "newListener"! Before
    // adding it to the listeners, first emit "newListener".
    if (events.newListener) {
      target.emit('newListener', type,
          listener.listener ? listener.listener : listener);

      // Re-assign `events` because a newListener handler could have caused the
      // this._events to be assigned to a new object
      events = target._events;
    }
    existing = events[type];
  }

  if (!existing) {
    // Optimize the case of one listener. Don't need the extra array object.
    existing = events[type] = listener;
    ++target._eventsCount;
  } else {
    if (typeof existing === 'function') {
      // Adding the second element, need to change to array.
      existing = events[type] =
          prepend ? [listener, existing] : [existing, listener];
    } else {
      // If we've already got an array, just append.
      if (prepend) {
        existing.unshift(listener);
      } else {
        existing.push(listener);
      }
    }

    // Check for listener leak
    if (!existing.warned) {
      m = $getMaxListeners(target);
      if (m && m > 0 && existing.length > m) {
        existing.warned = true;
        var w = new Error('Possible EventEmitter memory leak detected. ' +
            existing.length + ' "' + String(type) + '" listeners ' +
            'added. Use emitter.setMaxListeners() to ' +
            'increase limit.');
        w.name = 'MaxListenersExceededWarning';
        w.emitter = target;
        w.type = type;
        w.count = existing.length;
        if (typeof console === 'object' && console.warn) {
          console.warn('%s: %s', w.name, w.message);
        }
      }
    }
  }

  return target;
}

EventEmitter.prototype.addListener = function addListener(type, listener) {
  return _addListener(this, type, listener, false);
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.prependListener =
    function prependListener(type, listener) {
      return _addListener(this, type, listener, true);
    };

function onceWrapper() {
  if (!this.fired) {
    this.target.removeListener(this.type, this.wrapFn);
    this.fired = true;
    switch (arguments.length) {
      case 0:
        return this.listener.call(this.target);
      case 1:
        return this.listener.call(this.target, arguments[0]);
      case 2:
        return this.listener.call(this.target, arguments[0], arguments[1]);
      case 3:
        return this.listener.call(this.target, arguments[0], arguments[1],
            arguments[2]);
      default:
        var args = new Array(arguments.length);
        for (var i = 0; i < args.length; ++i)
          args[i] = arguments[i];
        this.listener.apply(this.target, args);
    }
  }
}

function _onceWrap(target, type, listener) {
  var state = { fired: false, wrapFn: undefined, target: target, type: type, listener: listener };
  var wrapped = bind.call(onceWrapper, state);
  wrapped.listener = listener;
  state.wrapFn = wrapped;
  return wrapped;
}

EventEmitter.prototype.once = function once(type, listener) {
  if (typeof listener !== 'function')
    throw new TypeError('"listener" argument must be a function');
  this.on(type, _onceWrap(this, type, listener));
  return this;
};

EventEmitter.prototype.prependOnceListener =
    function prependOnceListener(type, listener) {
      if (typeof listener !== 'function')
        throw new TypeError('"listener" argument must be a function');
      this.prependListener(type, _onceWrap(this, type, listener));
      return this;
    };

// Emits a 'removeListener' event if and only if the listener was removed.
EventEmitter.prototype.removeListener =
    function removeListener(type, listener) {
      var list, events, position, i, originalListener;

      if (typeof listener !== 'function')
        throw new TypeError('"listener" argument must be a function');

      events = this._events;
      if (!events)
        return this;

      list = events[type];
      if (!list)
        return this;

      if (list === listener || list.listener === listener) {
        if (--this._eventsCount === 0)
          this._events = objectCreate(null);
        else {
          delete events[type];
          if (events.removeListener)
            this.emit('removeListener', type, list.listener || listener);
        }
      } else if (typeof list !== 'function') {
        position = -1;

        for (i = list.length - 1; i >= 0; i--) {
          if (list[i] === listener || list[i].listener === listener) {
            originalListener = list[i].listener;
            position = i;
            break;
          }
        }

        if (position < 0)
          return this;

        if (position === 0)
          list.shift();
        else
          spliceOne(list, position);

        if (list.length === 1)
          events[type] = list[0];

        if (events.removeListener)
          this.emit('removeListener', type, originalListener || listener);
      }

      return this;
    };

EventEmitter.prototype.removeAllListeners =
    function removeAllListeners(type) {
      var listeners, events, i;

      events = this._events;
      if (!events)
        return this;

      // not listening for removeListener, no need to emit
      if (!events.removeListener) {
        if (arguments.length === 0) {
          this._events = objectCreate(null);
          this._eventsCount = 0;
        } else if (events[type]) {
          if (--this._eventsCount === 0)
            this._events = objectCreate(null);
          else
            delete events[type];
        }
        return this;
      }

      // emit removeListener for all listeners on all events
      if (arguments.length === 0) {
        var keys = objectKeys(events);
        var key;
        for (i = 0; i < keys.length; ++i) {
          key = keys[i];
          if (key === 'removeListener') continue;
          this.removeAllListeners(key);
        }
        this.removeAllListeners('removeListener');
        this._events = objectCreate(null);
        this._eventsCount = 0;
        return this;
      }

      listeners = events[type];

      if (typeof listeners === 'function') {
        this.removeListener(type, listeners);
      } else if (listeners) {
        // LIFO order
        for (i = listeners.length - 1; i >= 0; i--) {
          this.removeListener(type, listeners[i]);
        }
      }

      return this;
    };

function _listeners(target, type, unwrap) {
  var events = target._events;

  if (!events)
    return [];

  var evlistener = events[type];
  if (!evlistener)
    return [];

  if (typeof evlistener === 'function')
    return unwrap ? [evlistener.listener || evlistener] : [evlistener];

  return unwrap ? unwrapListeners(evlistener) : arrayClone(evlistener, evlistener.length);
}

EventEmitter.prototype.listeners = function listeners(type) {
  return _listeners(this, type, true);
};

EventEmitter.prototype.rawListeners = function rawListeners(type) {
  return _listeners(this, type, false);
};

EventEmitter.listenerCount = function(emitter, type) {
  if (typeof emitter.listenerCount === 'function') {
    return emitter.listenerCount(type);
  } else {
    return listenerCount.call(emitter, type);
  }
};

EventEmitter.prototype.listenerCount = listenerCount;
function listenerCount(type) {
  var events = this._events;

  if (events) {
    var evlistener = events[type];

    if (typeof evlistener === 'function') {
      return 1;
    } else if (evlistener) {
      return evlistener.length;
    }
  }

  return 0;
}

EventEmitter.prototype.eventNames = function eventNames() {
  return this._eventsCount > 0 ? Reflect.ownKeys(this._events) : [];
};

// About 1.5x faster than the two-arg version of Array#splice().
function spliceOne(list, index) {
  for (var i = index, k = i + 1, n = list.length; k < n; i += 1, k += 1)
    list[i] = list[k];
  list.pop();
}

function arrayClone(arr, n) {
  var copy = new Array(n);
  for (var i = 0; i < n; ++i)
    copy[i] = arr[i];
  return copy;
}

function unwrapListeners(arr) {
  var ret = new Array(arr.length);
  for (var i = 0; i < ret.length; ++i) {
    ret[i] = arr[i].listener || arr[i];
  }
  return ret;
}

function objectCreatePolyfill(proto) {
  var F = function() {};
  F.prototype = proto;
  return new F;
}
function objectKeysPolyfill(obj) {
  var keys = [];
  for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) {
    keys.push(k);
  }
  return k;
}
function functionBindPolyfill(context) {
  var fn = this;
  return function () {
    return fn.apply(context, arguments);
  };
}

},{}]},{},[1]);
