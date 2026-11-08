const path = require('node:path');
const {Eta} = require('eta');
const environment = require('./environment');
const {APP_NAME, CONTACT} = require('./config/brand');

const eta = new Eta({
  views: path.join(__dirname, '..', 'views'),
  cache: !environment.isDevelopment
});

/**
 * @param {object} [globals] Data passed to every template rendered by the returned function
 * @returns {(res: import('express').Response, template: string, data?: object) => void}
 */
const createRenderer = (globals) => (res, template, data) => {
  res.type('text/html').send(eta.render(`./${template}`, {
    APP_NAME,
    CONTACT,
    ...globals,
    ...data
  }));
};

module.exports = createRenderer;
