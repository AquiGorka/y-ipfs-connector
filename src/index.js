/* global Y */
'use strict'

const log = require('debug')('y-ipfs-connector')
const EventEmitter = require('events')
const Room = require('ipfs-pubsub-room')
const setImmediate = require('async/setImmediate')
const Buffer = require('safe-buffer').Buffer
const encode = require('./encode')
const decode = require('./decode')

function extend (Y) {
  class YIpfsConnector extends Y.AbstractConnector {
    constructor (y, options) {
      if (options === undefined) {
        throw new Error('Options must not be undefined!')
      }
      if (options.room == null) {
        throw new Error('You must define a room name!')
      }
      if (!options.ipfs) {
        throw new Error('You must define a started IPFS object inside options')
      }

      if (!options.role) { options.role = 'master' }
      super(y, options)

      this._yConnectorOptions = options

      this.ipfs = options.ipfs

      const topic = this.ipfsPubSubTopic = 'y-ipfs:rooms:' + options.room

      this.roomEmitter = options.roomEmitter || new EventEmitter()
      this.roomEmitter.peers = () => this._room.getPeers()
      this.roomEmitter.id = () => topic

      this._room = Room(this.ipfs, topic)
      this._room.setMaxListeners(Infinity)

      this._room.on('error', (err) => {
        console.error(err)
      })

      this._room.on('message', msg => {
        console.log('received message: ', msg)
        // no need to receive messages from oneself
        console.log('received message from: ', msg.from, this.ipfs._peerInfo.id.toB58String())
        if (this.ipfs._peerInfo && msg.from === this.ipfs._peerInfo.id.toB58String()) {
          return
        }
        const processMessage = () => {
          console.log('processMessage')
          // syncing messages
          if (msg.data instanceof Uint8Array || msg.data instanceof ArrayBuffer) {
            console.log('received message for syncing: ', msg.data.toString())
            this.receiveMessage(msg.from, msg.data)
            return
          }
          console.log('Rest of messages: ', msg)
        }
        if (!this._room.hasPeer(msg.from)) {
          console.log('From is not yet in room')
          const joinedListener = (peer) => {
            if (peer === msg.from) {
              console.log('From now in room')
              this._room.removeListener('peer joined', joinedListener)
              processMessage()
            }
          }
          this._room.on('peer joined', joinedListener)
        } else {
          console.log('From already in room')
          processMessage()
        }
      })

      this._room.on('subscribed', () => {
        console.log('subscribed', options)
        options.onSubscribed && options.onSubscribed()
      })

      this._room.on('peer joined', (peer) => {
        this.roomEmitter.emit('peer joined', peer)
        this.userJoined(peer, 'master')
      })

      this._room.on('peer left', (peer) => {
        this.roomEmitter.emit('peer left', peer)
        this.userLeft(peer)
      })

      if (this.ipfs.isOnline()) {
        this._start()
      } else {
        this.ipfs.once('ready', this._start.bind(this))
      }
    }
    send(peer, msg) {
      console.log('sending: ', peer, msg, msg.constructor)
      if (msg instanceof ArrayBuffer || msg instanceof Uint8Array) {
        this._room.sendTo(peer, msg)
      } else {
        this._room.sendTo(peer, encode({ payload: msg }))
        this.roomEmitter.emit('sent message', peer, msg)
      }
    }

    _start () {
      const id = this.ipfs._peerInfo.id.toB58String()
      this._ipfsUserId = id
    }

    disconnect () {
      log('disconnect')
      this._room.leave()
      super.disconnect()
    }
    isDisconnected () {
      return false
    }

    _encodeMessage (_message, callback) {
      const message = localEncode(_message)
      if (this._yConnectorOptions.sign) {
        this._yConnectorOptions.sign(Buffer.from(message), (err, signature) => {
          if (err) { return callback(err) }
          const sig = signature.toString('base64')
          callback(null, encode({
            signature: sig,
            payload: message
          }))
        })
      } else {
        callback(null, encode({
          payload: message
        }))
      }
    }
  }
  Y['ipfs'] = YIpfsConnector
}

module.exports = extend
if (typeof Y !== 'undefined') {
  extend(Y)
}

function localEncode (m) {
  return JSON.stringify(m)
}
