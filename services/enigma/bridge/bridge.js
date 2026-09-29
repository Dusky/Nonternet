'use strict';

//  SPIKE (M0): stub Enigma bridge. Runs inside the Enigma process as a webHandlers module.
//  Uses Enigma's own APIs only; never touches its SQLite files directly.

const WebHandlerModule = require('../../../web_handler_module');
const Config = require('../../../config').get;
const User = require('../../../user');
const Message = require('../../../message');
const { persistMessage } = require('../../../message_area');
const { jsonResponse, problemDetail, parseJsonBody } = require('../../../rest/util');

const userGroup = require('../../../user_group');
const UserProps = require('../../../user_property');
const crypto = require('crypto');
const moment = require('moment');
const _ = require('lodash');

exports.moduleInfo = {
    name: 'Bridge',
    desc: 'Private bridge API for core',
    author: 'site',
    packageName: 'site.enigma.bridge',
};

const BASE = '/bridge';

//  SPIKE: tickets are shared with the WebSocket ticket login server through a process
//  global. The real version needs a small shared module both sides can require.
const TICKET_TTL_MS = 30 * 1000;
const tickets = (globalThis.__siteTickets = globalThis.__siteTickets || new Map());

//  One-time redeem: returns true only if the ticket exists, is fresh, matches the handle.
globalThis.__siteRedeemTicket = (ticket, handle) => {
    const t = tickets.get(ticket);
    tickets.delete(ticket);
    return !!t && t.expires > Date.now() && t.handle.toLowerCase() === String(handle).toLowerCase();
};

//  Enigma has no hook for external auth, so wrap authenticateFactor1 for authType 'ticket'.
//  Everything else falls through to the original.
const origAuth = User.prototype.authenticateFactor1;
User.prototype.authenticateFactor1 = function (authInfo, cb) {
    if ('ticket' !== authInfo.type) {
        return origAuth.call(this, authInfo, cb);
    }
    if (!globalThis.__siteRedeemTicket(authInfo.password, authInfo.username)) {
        const { Errors } = require('../../../enig_error');
        return cb(Errors.AccessDenied('Invalid ticket'));
    }
    User.getUserIdAndName(authInfo.username, (err, userId, name) => {
        if (err) return cb(err);
        User.loadProperties(userId, (err, props) => {
            if (err) return cb(err);
            if (User.AccountStatus.active !== parseInt(props[UserProps.AccountStatus], 10)) {
                const { Errors } = require('../../../enig_error');
                return cb(Errors.AccessDenied('Account is not active'));
            }
            userGroup.getGroupsForUser(userId, (err, groups) => {
                if (err) return cb(err);
                this.userId = userId;
                this.username = name;
                this.properties = props;
                this.groups = groups;
                this.authFactor = User.AuthFactors.Factor1;
                this.authenticated = true; //  core already did 2FA before issuing the ticket
                return cb(null);
            });
        });
    });
};

exports.getModule = class BridgeWebHandler extends WebHandlerModule {
    init(webServer, cb) {
        this.webServer = webServer;
        const secret = _.get(Config(), 'contentServers.web.handlers.bridge.secret');
        if (!secret) {
            return cb(new Error('bridge: handlers.bridge.secret is required'));
        }

        const route = (method, re, fn) =>
            webServer.addRoute({
                method,
                path: new RegExp(`^${BASE}${re}(?:[?#]|$)`),
                handler: (req, resp) => {
                    if (req.headers['x-bridge-secret'] !== secret) {
                        return problemDetail(resp, 401, 'Unauthorized');
                    }
                    return fn(req, resp);
                },
            });

        route('POST', '/users', (req, resp) => this.createUser(req, resp));
        route('POST', '/areas', (req, resp) => this.createArea(req, resp));
        route('POST', '/tickets', (req, resp) => this.createTicket(req, resp));
        route('POST', '/areas/([^/]+)/messages', (req, resp) => this.postMessage(req, resp));
        return cb(null);
    }

    createUser(req, resp) {
        parseJsonBody(req, (err, body) => {
            if (err || !body || !body.handle || !body.password) {
                return problemDetail(resp, 400, 'Bad Request');
            }
            const user = new User();
            user.username = body.handle;
            user.create({ password: body.password }, err => {
                if (err) {
                    return problemDetail(resp, 409, 'Conflict', err.message);
                }
                return jsonResponse(resp, 201, { userId: user.userId, handle: user.username });
            });
        });
    }

    createTicket(req, resp) {
        parseJsonBody(req, (err, body) => {
            if (err || !body || !body.handle) {
                return problemDetail(resp, 400, 'Bad Request');
            }
            User.getUserIdAndName(body.handle, (err, userId, name) => {
                if (err) {
                    return problemDetail(resp, 404, 'Not Found', 'no such user');
                }
                const ticket = crypto.randomBytes(24).toString('hex');
                tickets.set(ticket, { handle: name, expires: Date.now() + TICKET_TTL_MS });
                return jsonResponse(resp, 201, { ticket, handle: name, expiresInSeconds: TICKET_TTL_MS / 1000 });
            });
        });
    }

    //  Runtime area creation by extending the live config object (spike 0.3).
    createArea(req, resp) {
        parseJsonBody(req, (err, body) => {
            if (err || !body || !body.conf || !body.tag || !body.name) {
                return problemDetail(resp, 400, 'Bad Request');
            }
            const conf = _.get(Config(), ['messageConferences', body.conf]);
            if (!conf) {
                return problemDetail(resp, 404, 'Not Found', 'no such conference');
            }
            conf.areas = conf.areas || {};
            conf.areas[body.tag] = { name: body.name, desc: body.desc || '', sort: 99 };
            return jsonResponse(resp, 201, { tag: body.tag });
        });
    }

    postMessage(req, resp) {
        const areaTag = req.url.match(/\/areas\/([^/?#]+)\/messages/)[1];
        parseJsonBody(req, (err, body) => {
            if (err || !body || !body.handle || !body.subject || !body.body) {
                return problemDetail(resp, 400, 'Bad Request');
            }
            User.getUserIdAndName(body.handle, (err, userId, name) => {
                if (err) {
                    return problemDetail(resp, 404, 'Not Found', 'no such user');
                }
                const msg = new Message({
                    areaTag,
                    toUserName: 'All',
                    fromUserName: name,
                    subject: String(body.subject).slice(0, 72),
                    message: String(body.body),
                    modTimestamp: moment(),
                });
                msg.setLocalFromUserId(userId);
                persistMessage(msg, err => {
                    if (err) {
                        return problemDetail(resp, 500, 'Internal Server Error', err.message);
                    }
                    return jsonResponse(resp, 201, { uuid: msg.messageUuid, id: msg.messageId });
                });
            });
        });
    }
};
