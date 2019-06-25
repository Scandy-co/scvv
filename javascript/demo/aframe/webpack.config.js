const webpack = require("webpack");
const path = require("path");
const HtmlWebPackPlugin = require("html-webpack-plugin");

const PORT = process.env.PORT || 3000

module.exports = {
  entry: {
    client: "./client.js"
  },
  output: {
    path: path.resolve(__dirname, "./public"),
    filename: "bundle.js",
    globalObject: "this"
  },
  mode: process.env.NODE_ENV || "development",
  node: {
    fs: "empty"
  },
  devServer: {
    // https: true,
    port: PORT,
    host: "0.0.0.0",
    inline: true,
    hot: true,
    contentBase: './public',
  },
  watch: true,
  watchOptions: {
    ignored: ['node_modules', 'dist', 'public'],
  },
  node: {
    fs: 'empty' // fixes bug with Draco making reference to fs from node
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: [/node_modules/, /lib/],
        use: {
          loader: "babel-loader",
          options: {
            presets: ['@babel/preset-env'],
          }
        }
      },
      { // Handle the Draco web assembly code
        test: /\.(wasmbin)$/,
        use: [
          {
            loader: 'url-loader',
            options: {
              limit: 340000
            },
          },
        ],
      },
    ],
  },
  plugins: [
    // Hot swap please!
    // new webpack.HotModuleReplacementPlugin(),

    // Serves the html
    new HtmlWebPackPlugin({
      template: "./index.html",
      filename: "./index.html"
    }),

    // Define env variables
    new webpack.DefinePlugin({
      'process.env.HOXEL_ASSET_URL': JSON.stringify(process.env.HOXEL_ASSET_URL) || `http://localhost:${PORT}/streamed`
    }),

    // Handle the WebWorker loading
    new webpack.LoaderOptionsPlugin({
      options: {
        worker: {
          output: {
            filename: "hash.worker.js",
            chunkFilename: "[id].hash.worker.js",
            globalObject: 'this'
          }
        }
      }
    })
  ],
};