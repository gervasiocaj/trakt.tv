'use strict';

// requirejs modules
const axios = require('axios').default
const randomBytes = require('randombytes');
const methods = require('./methods.json');
const sanitizer = require('sanitizer').sanitize;
const pkg = require('./package.json');

// default settings
const defaultUrl = 'https://api.trakt.tv';
const redirectUrn = 'urn:ietf:wg:oauth:2.0:oob';
const defaultUa = `${pkg.name}/${pkg.version} (NodeJS; +${pkg.repository.url})`;

module.exports = class Trakt {
    constructor(settings = {}, debug) {
        if (!settings.client_id) throw Error('Missing client_id');

        this._authentication = {};
        this._settings = {
            client_id: settings.client_id,
            client_secret: settings.client_secret,
            redirect_uri: settings.redirect_uri || redirectUrn,
            debug: settings.debug || debug,
            endpoint: settings.api_url || defaultUrl,
            pagination: settings.pagination,
            useragent: settings.useragent || defaultUa,
            sanitize: settings.sanitize !== false,
        };

        this._api = axios.create({
            baseURL: this._settings.endpoint,
            headers: {
                'User-Agent': this._settings.useragent,
                'Content-Type': 'application/json',
            },
            transformResponse: [].concat(
                axios.defaults.transformResponse,
                (data) => this._settings.sanitize ? this._sanitize(data) : data,
            ),
        });

        this._construct();

        if (settings.plugins) {
            this._plugins(settings.plugins, settings.options);
        }
    }

    // Creates methods for all requests
    _construct() {
        for (const url in methods) {
            const urlParts = url.split('/');
            const name = urlParts.pop(); // key for function

            let tmp = this;
            for (let p = 1; p < urlParts.length; ++p) { // acts like mkdir -p
                tmp = tmp[urlParts[p]] ||= {};
            }

            tmp[name] = (() => {
                const method = methods[url]; // closure forces copy
                return (params) => {
                    return this._call(method, params);
                };
            })();
        }

        this._debug(`Trakt.tv: module loaded, as ${this._settings.useragent}`);
    }

    // Initialize plugins
    _plugins(plugins, options = {}) {
        for (const name in plugins) {
            if (!Object.hasOwnProperty.call(plugins, name)) continue;

            this[name] = plugins[name];
            this[name].init(this, (options[name] || {}));
            this._debug(`Trakt.tv: ${name} plugin loaded`);
        }
    }

    // Debug & Print
    _debug(req) {
        if (!this._settings.debug) return;
        console.log(req.method ? `${req.method}: ${req.url}` : req);
    }

    // Authentication calls
    _exchange(str) {
        const req = {
            method: 'POST',
            url: `${this._settings.endpoint}/oauth/token`,
            data: str,
        };

        this._debug(req);
        return this._api(req).then(({ data }) => {
            this._authentication.refresh_token = data.refresh_token;
            this._authentication.access_token = data.access_token;
            this._authentication.expires = (data.created_at + data.expires_in) * 1000;

            return data;
        }).catch(error => {
            throw error.response?.statusCode == 401
                ? Error(error.response.headers['www-authenticate'])
                : error;
        });
    }

    // De-authentication POST
    _revoke() {
        const req = {
            method: 'POST',
            url: '/oauth/revoke',
            data: {
                token: this._authentication.access_token,
                client_id: this._settings.client_id,
                client_secret: this._settings.client_secret,
            }
        };
        this._debug(req);
        return this._api(req);
    }

    // Get code to paste on login screen
    _device_code(str, type) {
        const req = {
            method: 'POST',
            url: `/oauth/device/${type}`,
            data: str,
        };

        this._debug(req);
        return this._api(req).then(({ data }) => data).catch(error => {
            throw error.response?.statusCode == 401
                ? Error(error.response.headers['www-authenticate'])
                : error;
        });
    }

    // Parse url before api call
    _parse(method, params) {
        if (!params) params = {};

        const queryParts = [];
        const pathParts = [];

        // ?Part
        const queryPart = method.url.split('?')[1];
        const queryParams = queryPart?.split('&') || [];
        
        for (const query of queryParams) {
            const name = query.split('=')[0];
            const param = params[name];
            if (param || param === 0) {
                queryParts.push(`${name}=${encodeURIComponent(param)}`);
            }
        }
        
        // /part
        const pathPart = method.url.split('?')[0];
        const pathParams = pathPart.split('/');
        for (const path of pathParams) {
            if (path[0] != ':') {
                pathParts.push(path);
            } else {
                const name = path.substr(1);
                const param = params[name];
                if (param || param === 0) {
                    pathParts.push(param);
                } else {
                    // check for missing required params
                    if (method.optional?.indexOf(name) === -1) {
                        throw Error(`Missing mandatory paramater: ${name}`);
                    }
                }
            }
        }

        // Filters
        const filters = ['query', 'years', 'genres', 'languages', 'countries', 'runtimes', 'ratings', 'certifications', 'networks', 'status'];
        for (const p in params) {
            if (!filters.contains(p)) continue;
            const optionalQueryParam = `${p}=${encodeURIComponent(params[p])}`;
            if (!queryParts.contains(optionalQueryParam)) {
                queryParts.push(optionalQueryParam);
            }
        }

        // Pagination
        if (method.opts['pagination']) {
            params['page'] && queryParts.push(`page=${params['page']}`);
            params['limit'] && queryParts.push(`limit=${params['limit']}`);
        }

        // Extended
        if (method.opts['extended'] && params['extended']) {            
            queryParts.push(`extended=${params['extended']}`);
        }

        return [
            pathParts.join('/'),
            queryParts.length ? `?${queryParts.join('&')}` : '',
        ].join('');
    }

    // Parse methods then hit trakt
    _call(method, params) {
        if (method.opts['auth'] === true) {
            if (!this._authentication.access_token || !this._settings.client_secret) {
                throw Error('OAuth required');
            }
        }

        const req = {
            method: method.method,
            url: this._parse(method, params),
            headers: {
                'trakt-api-version': '2',
                'trakt-api-key': this._settings.client_id,
            },
            data: (method.body ? Object.assign({}, method.body) : {}),
        };

        if (method.opts['auth'] && this._authentication.access_token) {
            req.headers['Authorization'] = `Bearer ${this._authentication.access_token}`;
        }

        for (const k in params) {
            if (k in req.data) req.data[k] = params[k];
        }
        for (const k in req.data) {
            if (!req.data[k]) delete req.data[k];
        }

        if (method.method === 'GET') {
            delete req.data;
        }

        this._debug(req);
        return this._api(req).then(response => this._parseResponse(method, params, response));
    }

    // Parse trakt response: pagination & stuff
    _parseResponse (method, params, { data, headers }) {
        let parsed;

        if (params?.pagination || this._settings.pagination) {
            parsed = { data };

            if (method.opts.pagination && headers) {
                parsed.pagination = {
                    'item-count': headers['x-pagination-item-count'],
                    'limit': headers['x-pagination-limit'],
                    'page': headers['x-pagination-page'],
                    'page-count': headers['x-pagination-page-count'],
                };
            } else {
                parsed.pagination = false;
            }
        }

        return parsed || data;
    }

    // Sanitize output (xss)
    _sanitize(input) {
        const sanitizeString = string => sanitizer(string);

        const sanitizeObject = obj => {
            const result = obj;
            for (const prop in obj) {
                result[prop] = obj[prop];
                if (obj[prop]?.constructor === Object || obj[prop]?.constructor === Array) {
                    result[prop] = sanitizeObject(obj[prop]);
                } else if (obj[prop]?.constructor === String) {
                    result[prop] = sanitizeString(obj[prop]);
                }
            }
            return result;
        }

        let output = input;
        if (input?.constructor === Object || input?.constructor === Array) {
            output = sanitizeObject(input);
        } else if (input?.constructor === String) {
            output = sanitizeString(input);
        }

        return output;
    }

    // Get authentication url for browsers
    get_url() {
        this._authentication.state = randomBytes(6).toString('hex');
        // Replace 'api' from the api_url to get the top level trakt domain
        const base_url = this._settings.endpoint.replace(/api\W/, '');
        return `${base_url}/oauth/authorize?response_type=code&client_id=${this._settings.client_id}&redirect_uri=${this._settings.redirect_uri}&state=${this._authentication.state}`;
    }

    // Verify code; optional state
    exchange_code(code, state) {
        if (state && state != this._authentication.state) throw Error('Invalid CSRF (State)');

        return this._exchange({
            code: code,
            client_id: this._settings.client_id,
            client_secret: this._settings.client_secret,
            redirect_uri: this._settings.redirect_uri,
            grant_type: 'authorization_code'
        });
    }

    // Get authentification codes for devices
    get_codes() {
        return this._device_code({
            client_id: this._settings.client_id
        }, 'code');
    }

    // Calling trakt on a loop until it sends back a token
    poll_access(poll) {
        if (!poll || poll.constructor !== Object) {
            throw Error('Invalid Poll object');
        }

        const begin = Date.now();

        return new Promise((resolve, reject) => {
            const call = () => {
                if (begin + (poll.expires_in * 1000) <= Date.now()) {
                    clearInterval(polling);
                    return reject(Error('Expired'));
                }

                this._device_code({
                    code: poll.device_code,
                    client_id: this._settings.client_id,
                    client_secret: this._settings.client_secret
                }, 'token').then(body => {
                    this._authentication.refresh_token = body.refresh_token;
                    this._authentication.access_token = body.access_token;
                    this._authentication.expires = Date.now() + (body.expires_in * 1000); // Epoch in milliseconds

                    clearInterval(polling);
                    resolve(body);
                }).catch(error => {
                    // do nothing on 400
                    if (error.response?.statusCode === 400) return;

                    clearInterval(polling);
                    reject(error);
                });
            };

            const polling = setInterval(call, poll.interval * 1000);
        });
    }

    // Refresh access token
    refresh_token() {
        return this._exchange({
            refresh_token: this._authentication.refresh_token,
            client_id: this._settings.client_id,
            client_secret: this._settings.client_secret,
            redirect_uri: this._settings.redirect_uri,
            grant_type: 'refresh_token'
        });
    }

    // Import token
    async import_token(token) {
        this._authentication.access_token = token.access_token;
        this._authentication.expires = token.expires;
        this._authentication.refresh_token = token.refresh_token;

        if (token.expires < Date.now()) await this.refresh_token();

        return this.export_token();
    }

    // Export token
    export_token() {
        return {
            access_token: this._authentication.access_token,
            expires: this._authentication.expires,
            refresh_token: this._authentication.refresh_token
        };
    }

    // Revoke token
    async revoke_token() {
        if (this._authentication.access_token) {
            await this._revoke();
            this._authentication = {};
        }
    }
};
