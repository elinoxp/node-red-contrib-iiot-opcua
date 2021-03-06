/*
 The BSD 3-Clause License

 Copyright 2016,2017 - Klaus Landsdorf (http://bianco-royal.de/)
 Copyright 2015,2016 - Mika Karaila, Valmet Automation Inc. (node-red-contrib-opcua)
 All rights reserved.
 node-red-contrib-iiot-opcua
 */
'use strict'

/**
 * Browser Node-RED node.
 *
 * @param RED
 */
module.exports = function (RED) {
  // SOURCE-MAP-REQUIRED
  let coreBrowser = require('./core/opcua-iiot-core-browser')
  let browserEntries = []
  let nodesToRead = []

  function OPCUAIIoTBrowser (config) {
    RED.nodes.createNode(this, config)
    this.nodeId = config.nodeId
    this.name = config.name
    this.showStatusActivities = config.showStatusActivities
    this.showErrors = config.showErrors
    this.connector = RED.nodes.getNode(config.connector)

    let node = this
    node.items = []
    node.browseTopic = coreBrowser.core.OBJECTS_ROOT
    node.opcuaClient = null
    node.opcuaSession = null
    node.reconnectTimeout = 1000
    node.sessionTimeout = null

    node.verboseLog = function (logMessage) {
      if (RED.settings.verbose) {
        coreBrowser.internalDebugLog(logMessage)
      }
    }

    node.statusLog = function (logMessage) {
      if (RED.settings.verbose && node.showStatusActivities) {
        node.verboseLog('Status: ' + logMessage)
      }
    }

    node.setNodeStatusTo = function (statusValue) {
      node.statusLog(statusValue)
      let statusParameter = coreBrowser.core.getNodeStatus(statusValue, node.showStatusActivities)
      node.status({fill: statusParameter.fill, shape: statusParameter.shape, text: statusParameter.status})
    }

    node.resetSession = function () {
      if (!node.sessionTimeout && node.opcuaClient) {
        coreBrowser.internalDebugLog('Reset Session')
        node.connector.closeSession(node.opcuaSession, function () {
          node.startOPCUASessionWithTimeout(node.opcuaClient)
        })
      }
    }

    node.transformToEntry = function (reference) {
      if (reference) {
        try {
          return reference.toJSON()
        } catch (err) {
          coreBrowser.internalDebugLog(err)

          return {
            referenceTypeId: reference.referenceTypeId.toString(),
            isForward: reference.isForward,
            nodeId: reference.nodeId.toString(),
            browseName: reference.browseName.toString(),
            displayName: reference.displayName,
            nodeClass: reference.nodeClass.toString(),
            typeDefinition: reference.typeDefinition.toString()
          }
        }
      } else {
        coreBrowser.internalDebugLog('Empty Reference On Browse')
      }
    }

    node.browseErrorHandling = function (err, msg, itemList) {
      let results = []
      if (err) {
        results.push({
          displayName: {text: 'Objects'},
          nodeId: coreBrowser.core.OBJECTS_ROOT,
          browseName: 'Objects'
        })
        node.verboseLog('Browse Handle Error '.red + err)

        if (node.showErrors) {
          node.error(err, msg)
        }
        coreBrowser.internalDebugLog('Browser Error ' + err.message)
        node.status({fill: 'red', shape: 'dot', text: 'error'})

        if (err.message && err.message.includes('BadSession')) {
          node.resetSession()
        }
      } else {
        results = itemList
        coreBrowser.internalDebugLog('Browse Done With Error: ' + results.length + ' item(s)')
      }

      return results
    }

    node.browse = function (session, msg) {
      browserEntries = []
      nodesToRead = []
      coreBrowser.internalDebugLog('Browse Topic To Call Browse ' + node.browseTopic)

      if (session) {
        coreBrowser.browse(session, node.browseTopic).then(function (browserResult) {
          coreBrowser.internalDebugLog('Browser Root ' + node.browseTopic + ' on ' +
            session.name + ' Id: ' + session.sessionId)

          browserResult.browseResult.forEach(function (result) {
            result.references.forEach(function (reference) {
              coreBrowser.internalDebugLog('Add Reference To List :' + reference)
              browserEntries.push(node.transformToEntry(reference))
              if (reference.nodeId) {
                nodesToRead.push(reference.nodeId.toString())
              }
            })
          })

          node.status({fill: 'green', shape: 'dot', text: 'active'})
          node.sendMessage(msg)
        }).catch(function (err) {
          browserEntries = node.browseErrorHandling(err, msg, browserEntries)
          node.sendMessage(msg)
        })
      } else {
        coreBrowser.internalDebugLog('Session To Browse Is Not Valid')
      }
    }

    node.browseNodeList = function (session, msg) {
      browserEntries = []
      nodesToRead = []
      coreBrowser.internalDebugLog('Browse Node-List With Items ' + msg.addressSpaceItems.length)

      if (session) {
        msg.addressSpaceItems.map((entry) => (coreBrowser.browse(session, entry.nodeId).then(function (browserResult) {
          browserEntries = []
          nodesToRead = []
          coreBrowser.internalDebugLog('Browse ' + entry.nodeId + ' on ' +
            session.name + ' Id: ' + session.sessionId)

          browserResult.browseResult.forEach(function (result) {
            result.references.forEach(function (reference) {
              coreBrowser.internalDebugLog('Add Reference To List :' + reference)
              browserEntries.push(node.transformToEntry(reference))
              if (reference.nodeId) {
                nodesToRead.push(reference.nodeId.toString())
              }
            })
          })

          node.status({fill: 'green', shape: 'dot', text: 'active'})
          node.sendMessage(msg)
        }).catch(function (err) {
          browserEntries = node.browseErrorHandling(err, msg, browserEntries)
          node.sendMessage(msg)
        })))
      } else {
        coreBrowser.internalDebugLog('Session To Browse Is Not Valid')
      }
    }

    node.sendMessage = function (originMessage) {
      let msg = {}

      msg.nodetype = 'browse'
      msg.input = originMessage

      msg.payload = {
        browserItems: browserEntries,
        browserResultCount: browserEntries.length,
        browseTopic: node.browseTopic,
        endpoint: node.connector.endpoint,
        session: node.opcuaSession.name
      }

      msg.nodesToRead = nodesToRead
      msg.nodesToReadCount = nodesToRead.length

      node.send(msg)
    }

    node.on('input', function (msg) {
      node.browseTopic = null

      if (!node.opcuaSession) {
        node.error(new Error('Session Not Ready To Browse'), msg)
        return
      }

      node.browseTopic = node.extractBrowserTopic(msg)

      if (node.browseTopic && node.browseTopic !== '') {
        node.browse(node.opcuaSession, msg)
      } else {
        if (msg.addressSpaceItems) {
          node.browseNodeList(node.opcuaSession, msg)
        } else {
          node.error(new Error('No Topic To Browse'), msg)
        }
      }
    })

    node.extractBrowserTopic = function (msg) {
      let rootNodeId

      if (msg.payload.actiontype === 'browse') { // event driven browsing
        if (msg.payload.root && msg.payload.root.nodeId) {
          coreBrowser.internalDebugLog('Root Selected External ' + msg.payload.root)
          rootNodeId = node.browseByItem(msg.payload.root.nodeId) || node.browseToRoot()
        } else {
          rootNodeId = node.nodeId || node.browseToRoot()
        }
      } else {
        if (msg.topic !== '' && msg.topic.includes('=')) {
          rootNodeId = msg.topic // backward compatibles to v0.x
        } else {
          rootNodeId = node.nodeId
        }
      }

      return rootNodeId
    }

    node.browseByItem = function (nodeId) {
      coreBrowser.detailDebugLog('Browse To Parent ' + nodeId)
      return nodeId
    }

    node.browseToRoot = function () {
      coreBrowser.detailDebugLog('Browse To Root ' + coreBrowser.core.OBJECTS_ROOT)
      return coreBrowser.core.OBJECTS_ROOT
    }

    node.handleSessionError = function (err) {
      coreBrowser.internalDebugLog('Handle Session Error '.red + err)

      if (node.showErrors) {
        node.error(err, {payload: 'Session Error'})
      }

      node.resetSession()
    }

    node.startOPCUASession = function (opcuaClient) {
      node.sessionTimeout = null
      coreBrowser.internalDebugLog('Start OPC UA Session')
      node.opcuaClient = opcuaClient
      node.connector.startSession(coreBrowser.core.TEN_SECONDS_TIMEOUT, 'Browser Node').then(function (session) {
        node.opcuaSession = session
        coreBrowser.internalDebugLog('Session Connected')
        node.setNodeStatusTo('connected')
      }).catch(node.handleSessionError)
    }

    node.startOPCUASessionWithTimeout = function (opcuaClient) {
      if (node.sessionTimeout !== null) {
        clearTimeout(node.sessionTimeout)
        node.sessionTimeout = null
      }
      coreBrowser.internalDebugLog('starting OPC UA session with delay of ' + node.reconnectTimeout)
      node.sessionTimeout = setTimeout(function () {
        node.startOPCUASession(opcuaClient)
      }, node.reconnectTimeout)
    }

    node.connectorShutdown = function (opcuaClient) {
      coreBrowser.internalDebugLog('Connector Shutdown')
      if (opcuaClient) {
        node.opcuaClient = opcuaClient
      }
      // node.startOPCUASessionWithTimeout(node.opcuaClient)
    }

    if (node.connector) {
      node.connector.on('connected', node.startOPCUASessionWithTimeout)
      node.connector.on('after_reconnection', node.connectorShutdown)
    } else {
      throw new TypeError('Connector Not Valid')
    }

    node.on('close', function (done) {
      if (node.opcuaSession && node.connector.opcuaClient) {
        node.connector.closeSession(node.opcuaSession, function (err) {
          if (err) {
            coreBrowser.internalDebugLog('Error On Close Session ' + err)
          }
          node.opcuaSession = null
          done()
        })
      } else {
        node.opcuaSession = null
        done()
      }
    })

    node.setNodeStatusTo('waiting')
  }

  RED.nodes.registerType('OPCUA-IIoT-Browser', OPCUAIIoTBrowser)

  OPCUAIIoTBrowser.prototype.browseFromSettings = function (node, nodeId, res) {
    let entries = []
    let nodeRootId = nodeId || coreBrowser.core.OBJECTS_ROOT

    if (node.opcuaSession && nodeRootId) {
      coreBrowser.internalDebugLog('Session Is Valid And NodeId Is ' + nodeRootId)

      coreBrowser.browse(node.opcuaSession, nodeRootId).then(function (browserResult) {
        browserResult.browseResult.forEach(function (result) {
          if (result.references && result.references.length) {
            result.references.forEach(function (reference) {
              entries.push(node.transformToEntry(reference))
            })
          } else {
            coreBrowser.detailDebugLog(JSON.stringify(result))
          }
        })
        res.json(entries)
        browserEntries = entries
      }).catch(function (err) {
        if (err) {
          node.verboseLog(err)
        }

        entries.push({
          displayName: {text: 'Objects'},
          nodeId: coreBrowser.core.OBJECTS_ROOT,
          browseName: 'Objects'
        })
        res.json(entries)
        browserEntries = entries
      })
    } else {
      res.json(entries)
      browserEntries = entries
      coreBrowser.internalDebugLog('Session To Browse From Settings Is Not Valid')
    }
  }

  RED.httpAdmin.get('/opcuaIIoT/browser/:id/rootid/:rid', RED.auth.needsPermission('opcuaIIoT.browser.write'), function (req, res) {
    coreBrowser.detailDebugLog(browserEntries.length + ' Items In List On HTTP Request Body: ' + JSON.stringify(req.body))
    coreBrowser.detailDebugLog(browserEntries.length + ' Items In List On HTTP Request Params: ' + JSON.stringify(req.params))
    let node = RED.nodes.getNode(req.params.id)
    node.browseFromSettings(node, req.params.rid, res)
  })
}
