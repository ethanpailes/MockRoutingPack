/* global $, window */


//
// This module contains and exposes the
// Data Controller. This is where all the SAFE-Access happens
//
(function (MODULE) {
  // helper function to generate a random string for us
  function generateRandomString () {
    let text = ''
    let possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    for (let i = 0; i < 5; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length))
    }
    return text
  }

  function extractHandle(res) {
    return res.hasOwnProperty('handleId') ? res.handleId : res.__parsedResponseBody__.handleId;
  }

  //
  // The Controller holds the data and is the bridge to interact with
  // SAFE.
  class Controller {
    constructor () {
      // setup the internal state
      this._hostName = window.location.host.replace(/.safenet$/g, '')
      this._LOCAL_STORAGE_TOKEN_KEY = `SAFE_TOKEN_${this._hostName}`
      this._authToken = null
      this._currentPostHandleId = null
      this._blockedUserStructureDataHandle = null
      this._symmetricCipherOptsHandle = null

      // ensure we are cleaning up properly before closing
      $(window).on('beforeunload', () => {
        if (this._currentPostHandleId) {
          window.safeAppendableData.dropHandle(this._authToken, this._currentPostHandleId)
        }
        if (this._symmetricCipherOptsHandle) {
          window.safeCipherOpts.dropHandle(this._symmetricCipherOptsHandle)
        }
      })

      // start up the data container
      this._data = new MODULE.DataContainer()
    }

    //
    // Whenever something changes, the controller will emit an
    // event. The view (and any other interested party) can listen
    // to events and react accordingly.
    //
    // At the moment, the controller emits the follwing events:
    //  - `comments-updated` : the comments have changed
    //  - `user-updated`     : the user object has changed
    on (name, fn) {
      return $(this).on(name, fn)
    }

    emit (name, param) {
      return $(this).trigger(name, param)
    }

    // Once all is linked up, this is called to start up the connection
    // to save
    init () {
      // this._authToken = window.safeAuth.getAuthToken(this._LOCAL_STORAGE_TOKEN_KEY)
      // check if we have a local auth token
      return (this._authToken
          // if so, skip ahead to load DNS
          ? this._getDns()
          // if not we need to start by authorising the App
          : this._authoriseApp())
        // either way, once we have this setup, go ahead and fetch the comments
        .then(() => this.fetchComments())
    }

    // helper to gain access to the internal data
    getData () {
      return this._data
    }

    // is the current user owner of this URL
    isAdmin () {
      if (this._isDevMode() && this._data.user.dns) {
        return true
      }

      let currentDns = this._hostName.split('.').slice(-1)[0]
      if (!this._data.user.dns) {
        return
      }
      return this._data.user.dns.indexOf(currentDns) !== -1
    }

    // are comments generally enabled yet?
    commentsEnabled () {
      return !!this._currentPostHandleId
    }

    //
    // Global activities
    //

    //
    // If comments aren't enabled yet, this call allows one to start them
    // by creating the initial appendable data entry.
    //
    enableComments () {
      // create appendable dataHandleId for location
      return window.safeAppendableData.create(this._authToken, this._getLocation(), false)
        // remap handleID
        .then(extractHandle)
        .then((handleId) =>
          // now put the handleID, this actually creates the appendableData
          window.safeAppendableData.put(this._authToken, handleId)
            // after: store the handleID for later reuse
            .then(res => { this._currentPostHandleId = handleId }))
        .then(() => {
          // then emit to inform listeners that the comments state has changed
          this.emit('comments-updated')
        })
    }

    //
    // comment activities
    //
    // Fetch all comments from the network
    fetchComments () {
      // start by clearing the list
      this._data.commentList = []

      const fetchAll = (totalComments) => {
        let all = []
        
        if (totalComments === 0) {
          return;
        } 
        
        for (var i = 0; i < totalComments; i++) {
          all.push(i)
        }

        // fetch all the items in parallel, one at each index
        return Promise.all(
          all.map(index => this._fetchComment(index).then((c) => {
            // for each item found, append them to the commentsList
            this._data.commentList.push({
              index: index,
              comment: c
            })
          })))
      }

      // learn how many items there are in our list
      const getCommentsListLength = () => {
        MODULE.log('Fetch appendable data length')
        return window.safeAppendableData.getMetadata(
              this._authToken, this._currentPostHandleId)
          .then((res) => (res.hasOwnProperty('dataLength') ? res.dataLength : res.__parsedResponseBody__.dataLength))
      }

      // fetch the actual appendableData
      const fetchCommentsListing = (dataHandleId) => {
        MODULE.log('Fetch appendable data')
        return window.safeAppendableData.getHandle(
              this._authToken, dataHandleId)
          .then((res) => { this._currentPostHandleId = extractHandle(res) })
      }

      // tying it all together
      const fetchComments = (handleId) =>
        Promise.resolve(handleId)
          // first fetch the listing itself
          .then(fetchCommentsListing)
          // learn about the count
          .then(getCommentsListLength)
          // then fetch each item
          .then(fetchAll)
          // once we have all comments, sort them
          .then(() => this._sortComments())
          // and emit the events, even if something failed
          .then((r) => this.emit('comments-updated'),
                (e) => {
                  MODULE.log(e)
                  this.emit('comments-updated')
                  return e
                })

      // put it all in motion:
      return this._autoRelease(
        // get handle for appendable data
        window.safeDataId.getAppendableDataHandle(this._authToken, this._getLocation()),
        // fetch the comments with that handle
        fetchComments,
        // release teh appendable data handle
        (dataIdHandle) => window.safeDataId.dropHandle(this._authToken, dataIdHandle))
    }

    //
    // Posting a new comment
    //
    postComment (comment, publicName) {
      MODULE.log(`Writing comment @${publicName}: ${comment}`)

      // convert the input into data SAFEnet understands
      const timeStamp = (new Date()).getTime()
      const name = publicName + timeStamp + generateRandomString()
      const payload = new Buffer(JSON.stringify({
        name: publicName,
        comment: comment,
        time: timeStamp
      }));

      // and off it goes
      return this._autoRelease(
        window.safeImmutableData.getWriterHandle(this._authToken),
        // write data
        (writerHandle) => window.safeImmutableData.write(this._authToken, writerHandle, payload)
          // save the data then
          .then(() => this._autoRelease(
            // replace the structured Data handle for a dataID handle
            window.safeImmutableData.closeWriter(this._authToken, writerHandle),
            // append that handle to the appendable data
            (dataIdHandle) => window.safeAppendableData.append(this._authToken, this._currentPostHandleId, dataIdHandle),
            // release the dataId handle
            (dataIdHandle) => window.safeDataId.dropHandle(this._authToken, dataIdHandle)
            )
            .catch(err => {
              window.alert('Could not post a comment');
            })
          ),
          (writerHandle) => window.safeImmutableData.dropWriter(this._authToken, writerHandle)
          .then(() => this.fetchComments())
        );
    }

    //
    // Delete a comment at the given index
    //

    deleteComment (index) {
      // prepare the removable of a specific index
      return window.safeAppendableData.removeAt(this._authToken, this._currentPostHandleId, index)
        .then(() => window.safeAppendableData.post(this._authToken, this._currentPostHandleId))
        .then(() =>
          // clear deleted data
          window.safeAppendableData.clearAll(this._authToken, this._currentPostHandleId, true))
        .then(() => window.safeAppendableData.post(this._authToken, this._currentPostHandleId))
        // and refresh all comments
        .then(() => this.fetchComments())
    }

    //
    // user blocking management
    //

    blockUser (userName, index) {
      // get appendable data signed key at index
      return this._autoRelease(
          window.safeAppendableData.getSignKeyAt(this._authToken, this._currentPostHandleId, index),
          (signKeyHandleId) =>
            window.safeAppendableData.addToFilter(this._authToken, this._currentPostHandleId, [signKeyHandleId])
              .then(() => window.safeAppendableData.post(this._authToken, this._currentPostHandleId))
              .then(() => this._saveBlockedUser(userName, signKeyHandleId))
              .then(() => this.fetchComments()),
          (signKeyHandleId) => window.safeSignKey.dropHandle(this._authToken, signKeyHandleId))
        .then(data => this.emit('comments-updated'))
    }

    unblockUser (userName) {
      return this._autoRelease(
        // get a serialiased key
        window.safeSignKey.deserialise(this._authToken, new Buffer(this._data.blockedUsers[userName], 'base64')),
        (signKeyHandle) =>
          window.safeAppendableData.removeFromFilter(
            this._authToken,
            this._currentPostHandleId,
            [signKeyHandle])
          .then(res => window.safeAppendableData.post(
              this._authToken, this._currentPostHandleId)
          .then(res => {
            delete this._data.blockedUsers[userName]
            const data = new Buffer(JSON.stringify(this._data.blockedUsers)).toString('base64')
            return window.safeStructuredData.updateData(
                this._authToken,
                this._blockedUserStructureDataHandle,
                data, this._symmetricCipherOptsHandle)
              .then(res => window.safeStructuredData.post(
                    this._authToken, this._blockedUserStructureDataHandle)
              )
          }
          )
          .then(() => this.fetchComments())
          .then(data => this.emit('comments-updated'))
        ),
        // release signing key
        (signKeyHandle) => window.safeSignKey.dropHandle(this._authToken, signKeyHandle)
      )
    }

    hasAuthToken() {
      return !!this._authToken;
    }

    hasBlockedUsers () {
      return (this._data.blockedUsers && (Object.keys(this._data.blockedUsers).length !== 0));
    }

    //
    // Internals
    //

    // figure out the location the information is to be stored
    _getLocation () {
      if (this._isDevMode() && this._data.user.dns) {
        return `comments-dev-${this._data.user.dns}/${window.location.pathname}`
      }
      return `${this._hostName}/${window.location.pathname}`
    }

    // if we are running from localhost, put the app into developer mode
    _isDevMode () {
      return !!this._hostName.match(/^localhost(:[\d]+)?$/)
    }

    _getCypher () {
      return window.safeCipherOpts.getHandle(
          this._authToken,
          window.safeCipherOpts.getEncryptionTypes().SYMMETRIC)
        .then(res => { this._symmetricCipherOptsHandle = extractHandle(res) })
    }

    //
    // Helper function for a typical use case:
    //  1. get a data handle (as `promise`)
    //  2. run the code `fn` (with the handle as the first parameter)
    //  3. once execution completed, clean up the handle by calling `release`
    //
    _autoRelease (promise, fn, release) {
      return promise
        .then(extractHandle)
        .then(handleId => fn(handleId)
          .then((r) => release(handleId).then(() => r),
                (e) => release(handleId).then(() => Promise.reject(e)
          ))
        )
    }

    _fetchBlockeUsersData () {
      return this._autoRelease(
          // get dataHandle
          window.safeDataId.getStructuredDataHandle(
            this._authToken, this._getLocation() + '_blocked_users', 500),
          // replace dataHandle With structuredDataHandle
          (dataHandle) => window.safeStructuredData.getHandle(this._authToken, dataHandle),
          // release dataHandle
          (dataHandle) => window.safeDataId.dropHandle(this._authToken, dataHandle))
        .then(extractHandle)
        .then(handleId => {
          // keep the structured data handle around for later reuse
          this._blockedUserStructureDataHandle = handleId
          // and read the data with it
          return window.safeStructuredData.readData(
              this._authToken,
              this._blockedUserStructureDataHandle)
        })
    }

    // serialise the key then call fn
    _withSignedKey (signKeyHandle, fn) {
      return window.safeSignKey.serialise(this._authToken, signKeyHandle)
        .then(res => (new Buffer(res).toString('base64')))
        .then(fn)
    }

    // given a specific address, get a handle, read it, release the handle
    // and return the read Data
    _readAndRelease (address) {
      return this._autoRelease(
        // get reader handle
        window.safeImmutableData.getReaderHandle(this._authToken, address),
        // read immutable data from handle id
        (handleId) => window.safeImmutableData.read(this._authToken, handleId),
        // release handle id
        (hId) => window.safeImmutableData.dropReader(this._authToken, hId)
        )
    }

    // fetch the comment at `index
    _fetchComment (index) {
      return this._autoRelease(
          // get data handle for position
          window.safeAppendableData.getDataIdAt(
                this._authToken, this._currentPostHandleId, index),
          // read data at position
          (dataid) => this._readAndRelease(dataid),
          // release data handle
          (dataIdHandle) => window.safeDataId.dropHandle(this._authToken, dataIdHandle))
        // convert the given data to JSON
        .then((data) => JSON.parse(new Buffer(data).toString()))
    }

    // we like our comments sorted by time
    _sortComments () {
      this._data.commentList.sort((a, b) => {
        return new Date((b.data || b.comment).time) - new Date((a.data || a.comment).time)
      })
    }

    // refresh the blocked users structure
    _getBlockedUsersStructuredData () {
      return this._fetchBlockeUsersData()
        .then(data => {
          this._data.blockedUsers = JSON.parse(new Buffer(data).toString()) 
        })
        .then(data => this.emit('comments-updated'))
        .catch(err => {
          console.error(err);
        });
    }

    // let's block a user
    _saveBlockedUser (userName, signKeyHandle) {
      // we already have a list of blocked users
      // update the block
      if (this._blockedUserStructureDataHandle !== null) {
        return this._withSignedKey(signKeyHandle, (serialisedSignKey) => {
          this._data.blockedUsers[userName] = serialisedSignKey
          return window.safeStructuredData.updateData(
              this._authToken,
              this._blockedUserStructureDataHandle,
              new Buffer(JSON.stringify(this._data.blockedUsers)).toString('base64'), this._symmetricCipherOptsHandle)
            .then(res => window.safeStructuredData.post(
                this._authToken,
                this._blockedUserStructureDataHandle)
            )
        })
      } else {
        // This is the first time a user is blocked, created
        // the block structure to keep track of the users blocked
        return this._withSignedKey(signKeyHandle, (serialisedSignKey) => {
          this._data.blockedUsers = {}
          this._data.blockedUsers[userName] = serialisedSignKey
          return window.safeStructuredData.create(
              this._authToken,
              this._getLocation() + '_blocked_users', 500,
              new Buffer(JSON.stringify(this._data.blockedUsers)).toString('base64'),
              this._symmetricCipherOptsHandle)
            .then(res => { this._blockedUserStructureDataHandle = extractHandle(res) })
            .then(res => window.safeStructuredData.put(
                  this._authToken,
                  this._blockedUserStructureDataHandle)
            )
        }
        )
      }
    }

    // fetch the public names of the user
    _getDns () {
      MODULE.log('Fetching DNS records')
      return window.safeDNS.listLongNames(this._authToken)
        // convert
        .then((res) => (res.hasOwnProperty('__parsedResponseBody__') ? res.__parsedResponseBody__ : res))
        .then((dnsData) => {
          // store dnsData on the user for later reuse
          this._data.user.dns = dnsData
          if (this.isAdmin()) {
            // As the admin, we should also read the blocked user structure
            // but do that once we are done with this cycle
            window.setTimeout(() => this._getBlockedUsersStructuredData(), 10)
          }
          this._getCypher();
          // and emit an event so the UI can update
          this.emit('user-updated')
        })
        .catch(err => {
          if (err.message.indexOf('401 Unauthorized') !== -1) {
            return (this._authToken ? this._authoriseApp() : this.fetchComments());
          }
        });
    }

    // starting up, we need to authorise the app
    _authoriseApp () {
      MODULE.log('Authorising application')
      return window.safeAuth.authorise(this._data.appInfo, this._LOCAL_STORAGE_TOKEN_KEY)
        // convert tokeb
        .then((res) => {
          if (typeof res === 'object') {
            return res.hasOwnProperty('token') ? res.token : res.__parsedResponseBody__.token
          }
          return res;
        })
        .then((token) => {
          if (typeof token !== 'string') {
            return;
          }
          // keep token for later reus`e
          this._authToken = token
          // window.safeAuth.setAuthToken(this._LOCAL_STORAGE_TOKEN_KEY, token)
        })
        // then refresh the DNS
        .then(() => this._getDns())
        .catch((err) => {
          // something went terribly wrong,
          // remove the auth token
          console.error(err)
          this._authToken = null
          this.fetchComments();
          return Promise.reject(err)
        })
    }
  }

  // Expose the Controller to the global MODULE
  MODULE.Controller = Controller
})(window.safeComments)
