/* eslint-env node */
const webpack = require("webpack");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

dotenv.config();
const ForkTsCheckerWebpackPlugin = require("fork-ts-checker-webpack-plugin");
// const ESLintPlugin = require("eslint-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");
const WorkboxPlugin = require("workbox-webpack-plugin");

function parseOptionalBooleanEnv(value) {
        if(typeof value !== "string") return undefined;
        const normalized = value.trim().toLowerCase();
        if(normalized.length === 0) return undefined;
        if(normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") return true;
        if(normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") return false;
        throw new Error(`Invalid boolean environment value: ${value}`);
}

function parseBooleanEnv(value, defaultValue = false) {
        const parsedValue = parseOptionalBooleanEnv(value);
        if(parsedValue === undefined) return defaultValue;
        return parsedValue;
}

module.exports = (env) => {
        const bffEnabled = parseBooleanEnv(process.env.BFF_ENABLED, true);
        // Keep webpack dev-server routing aligned with the default BFF transport mode.
        const bffDevProxyEnabled = parseBooleanEnv(process.env.BFF_DEV_PROXY_ENABLED, bffEnabled);

        return ({
	entry: "./src/index.tsx",
	target: "web",
	mode: env.WEBPACK_SERVE ? "development" : "production",
	devtool: env.WEBPACK_SERVE ? "cheap-source-map" : "source-map",
        devServer: {
                static: {
                        directory: path.join(__dirname, "public")
                },
                host: "0.0.0.0",
                allowedHosts: "all",
                port: 8080,
                proxy: bffDevProxyEnabled ? [
                        {
                                context: ["/bff", "/bff/socket"],
                                target: process.env.BFF_PROXY_TARGET ?? "http://127.0.0.1:3100",
                                changeOrigin: true,
                                ws: true
                        }
                ] : undefined,
                https: env.secure ? {
                        key: fs.readFileSync("webpack.key"),
                        cert: fs.readFileSync("webpack.crt"),
                } : undefined
	},
	output: {
		path: path.resolve(__dirname, "build"),
		filename: "index.js",
		assetModuleFilename: "res/[hash][ext][query]",
		publicPath: "",
		clean: true
	},
	module: {
		rules: [
			{
				test: /\.ts(x)?$/,
				loader: "ts-loader",
				exclude: /node_modules/,
				options: {
					transpileOnly: true
				}
			},
			{
				enforce: "pre",
				test: /\.js$/,
				loader: "source-map-loader"
			},
			{
				test: /\.css$/,
				use: [
					"style-loader",
					"css-loader"
				],
				exclude: /\.module\.css$/
			},
			{
				test: /\.css$/,
				use: [
					"style-loader",
					{
						loader: "css-loader",
						options: {
							importLoaders: 1,
							modules: true
						}
					}
				],
				include: /\.module\.css$/
			},
			{
				test: /\.(svg)|(wav)$/,
				type: "asset/resource"
			},
			{
				test: /\.md$/,
				type: "asset/source"
			}
		]
	},
	resolve: {
		extensions: [
			".tsx",
			".ts",
			".js"
		],
		alias: {
			"shared": path.resolve(__dirname, "src")
		}
	},
	optimization: {
		usedExports: true
	},
	plugins: [
		new ForkTsCheckerWebpackPlugin(),
		/* new ESLintPlugin({
			files: ["src", "browser", "electron-main", "electron-renderer"],
			extensions: ["js", "jsx", "ts", "tsx"]
		}), */
		new CopyPlugin({
			patterns: [
				{from: "public"}
			]
		}),
                new webpack.DefinePlugin({
                        "WPEnv.ENVIRONMENT": JSON.stringify(env.WEBPACK_SERVE ? "development" : "production"),
                        "WPEnv.PACKAGE_VERSION": JSON.stringify(process.env.npm_package_version),
                        "WPEnv.RELEASE_HASH": "\"undefined\"",
                        "WPEnv.BUILD_DATE": Date.now(),
                        "WPEnv.BFF_ENABLED": JSON.stringify(bffEnabled),
                        "WPEnv.BFF_DIRECT_MODE_ENABLED": JSON.stringify(parseBooleanEnv(process.env.BFF_DIRECT_MODE_ENABLED)),
                        "WPEnv.SENTRY_DSN": JSON.stringify(process.env.SENTRY_DSN ?? ""),
                        "WPEnv.LINK_PREVIEW_API_KEY": JSON.stringify(process.env.LINK_PREVIEW_API_KEY ?? "")
                }),
		].concat(!env.WEBPACK_SERVE ? new WorkboxPlugin.GenerateSW() : [])
        });
};
