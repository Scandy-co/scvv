const _ = require('lodash');
const path = require('path');

const webpack = require("webpack");
const webpackConfig = require("./webpack.config");
const compiler = webpack(webpackConfig);

const logger = require('morgan');
const express = require('express');
const app = express();
const http = require('http').Server(app);


const HOST = '0.0.0.0';

/**
 * Setup the Express server
 */
// view engine setup
// app.set('views', path.join(__dirname, './'));
app.set('view engine', 'html');
// app.set('views', path.join(__dirname, 'views'));
app.use(logger('dev'));
app.use(express.static(path.join(__dirname, 'public')));

// webpack hmr
app.use(
  require("webpack-dev-middleware")(compiler, {
      noInfo: true,
      publicPath: webpackConfig.output.publicPath
  })
);

app.use(require("webpack-hot-middleware")(compiler));

app.get('/', function(req, res){
  res.render('index.html');
});

const HTTP_PORT = 3000
http.listen(HTTP_PORT, HOST, function(){
  console.log(`listening on http://${HOST}:${HTTP_PORT}`);
});
