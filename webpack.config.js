const path = require('path');
const HtmlWebpackPlugin = require("html-webpack-plugin");
const webpack = require("webpack");

module.exports = [
    {
        entry: './src/react/index.tsx',
        target: 'electron-main',
        output: {
            path: path.join(__dirname, "dist"),
            filename: "index.bundle.js"
        },
        node: {
            __dirname: false,
        },
        mode: process.env.NODE_ENV || "development",
        resolve: {
            extensions: [".tsx", ".ts", ".js"],
        },
        module: {
            rules: [
                // {
                //     test: /\.(js|jsx)$/,
                //     exclude: /node_modules/,
                //     use: ["babel-loader"],
                // },
                // {
                //     test: /\.(ts|tsx)$/,
                //     exclude: /node_modules/,
                //     use: ["ts-loader"],
                // },
                {
                    test: /\.(ts|js)x?$/,
                    exclude: /node_modules/,
                    use: {
                        loader: "babel-loader",
                        options: {
                            presets: [
                                "@babel/preset-env",
                                "@babel/preset-react",
                                "@babel/preset-typescript",
                            ],
                        },
                    },
                },
                {
                    test: /\.(css)$/,
                    exclude: /node_modules/,
                    use: ["style-loader", "css-loader"],
                },
                {
                    test: /\.s[ac]ss$/i,
                    use: [
                      "style-loader",
                      {
                        loader: 'css-loader',
                        options: {
                          esModule: false
                        }
                      },
                      "sass-loader",
                    ],
                },
                {
                    test: /\.(jpg|jpeg|png|svg)$/,
                    exclude: /node_modules/,
                    use: ["url-loader"],
                },
                {
                    test: /\.(gif|mp3)$/,
                    exclude: /node_modules/,
                    use: ["file-loader"],
                },
            ],
        },
        plugins: [
            new HtmlWebpackPlugin({
                template: path.join(__dirname, "src", "react", "index.html"),
            }),
        ],
    },
];