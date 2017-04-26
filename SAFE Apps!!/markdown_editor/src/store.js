/* global btoa, safeAuth, safeNFS safeCipherOpts, safeStructuredData, safeDataId */

// this is only file directly interacting with SAFE

import { APP_ID, APP_NAME, APP_VERSION } from './config.js'

if (process.env.NODE_ENV !== 'production') {
  require('safe-js/dist/polyfill')
}

// global access state
let ACCESS_TOKEN;
let SYMETRIC_CYPHER_HANDLE;
let INDEX_HANDLE;
let FILE_INDEX;
let USER_PREFIX;

// legacy style fallback
const extractHandle = (res) => res.hasOwnProperty('handleId') ? res.handleId : res.__parsedResponseBody__.handleId;

const _createRandomUserPrefix = () => {
  let randomString = '';
  for (var i = 0; i < 10; i++) {
    // and ten random ascii chars
    randomString += String.fromCharCode(Math.floor(Math.random(100) * 100));
  }
  return btoa(`${APP_ID}@${APP_VERSION}#${(new Date()).getTime()}-${randomString}`);
};

const _refreshCypherHandle = () => {
  return safeCipherOpts.getHandle(ACCESS_TOKEN,
    window.safeCipherOpts.getEncryptionTypes().SYMMETRIC)
    .then(res => {
        SYMETRIC_CYPHER_HANDLE = extractHandle(res);
        return SYMETRIC_CYPHER_HANDLE;
      }
    );
};

const _refreshConfig = () => {
  // reading the config from NFS or create it if not yet existing.
  const FILE_NAME = 'app_config.json';
  return safeNFS.createFile(ACCESS_TOKEN,
    // try to create instead then
    FILE_NAME,
    JSON.stringify({ 'user_prefix': _createRandomUserPrefix() }), 'application/json')
    .catch(err => err.errorCode === -505 ? '' : console.error(err)) // ignore file already exists
    .then(() => safeNFS.getFile(ACCESS_TOKEN, FILE_NAME))
    .then(resp => resp.json ? resp.json() : JSON.parse(resp.toString()))
    .then(config => (USER_PREFIX = config.user_prefix));
};

const getSDHandle = (filename) => {
  let dataIdHandle = null;
  return safeDataId.getStructuredDataHandle(ACCESS_TOKEN, btoa(`${USER_PREFIX}:${filename}`), 501)
    .then(extractHandle)
    .then(handleId => (dataIdHandle = handleId))
    .then(() => safeStructuredData.getHandle(ACCESS_TOKEN, dataIdHandle))
    .then(extractHandle)
    .then(handleId => {
      safeDataId.dropHandle(ACCESS_TOKEN, dataIdHandle);
      return handleId;
    })
};

const updateFile = (filename, payload) => {
  let handleId = null;
  return getSDHandle(filename)
    .then(sdHandleId => (handleId = sdHandleId))
    .then(() => safeStructuredData.updateData(ACCESS_TOKEN, handleId, payload, SYMETRIC_CYPHER_HANDLE))
    .then(() => safeStructuredData.post(ACCESS_TOKEN, handleId))
};

export const authorise = () => {
  if (ACCESS_TOKEN) return Promise.resolve(ACCESS_TOKEN);

  return safeAuth.authorise({
      'name': APP_NAME,
      'id': APP_ID,
      'version': APP_VERSION,
      'vendor': 'MaidSafe Ltd.',
      'permissions': ['LOW_LEVEL_API']
    },
    APP_ID)
    .then(res => res.__parsedResponseBody__ || res) // legacy style fallback
    .then(auth => auth.token === APP_ID ? safeAuth.getAuthToken(APP_ID) : auth.token)
    .then(token => {
        if (!token) {
          alert("Authentication failed");
          throw Error("Authentication Failed");
        }
        ACCESS_TOKEN = token;
        // then fetch a fresh cypherHandle
        return Promise.all([
          _refreshCypherHandle(),
          _refreshConfig()
        ]).then(() => ACCESS_TOKEN)
      }
    );
};

const _putFileIndex = () => {
  return safeStructuredData.updateData(ACCESS_TOKEN,
    INDEX_HANDLE,
    new Buffer(JSON.stringify(FILE_INDEX)).toString('base64'),
    SYMETRIC_CYPHER_HANDLE)
    .then(() => safeStructuredData.post(ACCESS_TOKEN, INDEX_HANDLE));
};

export const saveFile = (filename, data) => {
  const payload = new Buffer(JSON.stringify({
    ts: (new Date()).getTime(),
    content: data
  })).toString('base64');

  if (FILE_INDEX[filename]) {
    // this was an edit, add new version
    console.log("existing");
    return updateFile(filename, payload);
  } else {
    // file is being created for the first time
    return safeStructuredData.create(ACCESS_TOKEN,
      // trying to come up with a name that is super unlikely to clash ever.
      btoa(`${USER_PREFIX}:${filename}`),
      // 501 => we want this versioned
      501, payload, SYMETRIC_CYPHER_HANDLE)
      .then(extractHandle)
      // save the structure
      .then(handle => safeStructuredData.put(ACCESS_TOKEN, handle)
        // fetch a permanent reference
          .then(() => safeStructuredData.getDataIdHandle(ACCESS_TOKEN, handle))
          // add the reference to the file index
          .then((dataHandleId) => {
            FILE_INDEX[filename] = dataHandleId;
            return _putFileIndex()
          })
      )
  }
};

export const getFileIndex = () => {
  if (FILE_INDEX) return Promise.resolve(FILE_INDEX);
  const INDEX_FILE_NAME = btoa(`${USER_PREFIX}#index`);

  return safeDataId.getStructuredDataHandle(ACCESS_TOKEN, INDEX_FILE_NAME, 500)
    .then(extractHandle)
    .then(handle => safeStructuredData.getHandle(ACCESS_TOKEN, handle)
      .then(extractHandle)
      // drop data Handle
      // .then(sdHandle => safeDataId.dropHandle(handle).then(() => sdHandle))
      .then(sdHandle => {
          // store the handle for future reference
          INDEX_HANDLE = sdHandle;
          // let's try to read
          return safeStructuredData.readData(ACCESS_TOKEN, sdHandle, '')
            .then(resp => resp.json ? resp.json() : JSON.parse(new Buffer(resp).toString()))
        },
        (e) => {
          console.error(e);
          FILE_INDEX = {};
          return safeStructuredData.create(ACCESS_TOKEN, INDEX_FILE_NAME, 500,
            new Buffer(JSON.stringify({})).toString('base64'), SYMETRIC_CYPHER_HANDLE)
            .then(extractHandle)
            .then(handle => (INDEX_HANDLE = handle))
            .then(() => safeStructuredData.put(ACCESS_TOKEN, INDEX_HANDLE)
              // don't forget to clean up that handle
              //   .then(() => safeStructuredData.dropHandle(handle))
            )
            // and return empty data as payload
            .then(() => {
              return {}
            })
        }))
    .then(payload => {
      // store payload for future reference
      FILE_INDEX = payload;
      return FILE_INDEX;
    });
};

export const readFile = (filename, version) => {
  return getSDHandle(filename)
    .then(handleId => safeStructuredData.readData(ACCESS_TOKEN, handleId, version));
};

export const getSDVersions = (filename) => {
  let sdHandleId = null;
  return getSDHandle(filename)
    .then(handleId => (sdHandleId = handleId))
    .then(() => safeStructuredData.getMetadata(ACCESS_TOKEN, sdHandleId))
    .then(res => res.hasOwnProperty('version') ? res.version : res.__parsedResponseBody__.version)
    .then(sdVersion => {
      const iterator = [];
      for (let i = 0; i <= sdVersion; i++) {
        iterator.push(i);
      }
      return Promise.all(iterator.map(version => safeStructuredData.readData(ACCESS_TOKEN, sdHandleId, version)));
    });
};
