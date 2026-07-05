const path = require("path");
const webpack = require("webpack");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const CopyPlugin = require("copy-webpack-plugin");
const ZipPlugin = require("zip-webpack-plugin");

module.exports = (env, argv) => {
    const production = argv.mode === "production";
    const plugins = [
        new MiniCssExtractPlugin({
            filename: production ? "dist/index.css" : "index.css",
        }),
    ];
    if (production) {
        plugins.push(
            new webpack.BannerPlugin({
                banner: () => require("fs").readFileSync("LICENSE").toString(),
            }),
        );
        plugins.push(
            new CopyPlugin({
                patterns: [
                    { from: "preview.png", to: "./dist/" },
                    { from: "icon.png", to: "./dist/" },
                    { from: "README*.md", to: "./dist/" },
                    { from: "plugin.json", to: "./dist/" },
                    { from: "src/i18n/", to: "./dist/i18n/" },
                ],
            }),
        );
        plugins.push(
            new ZipPlugin({
                filename: "package.zip",
                algorithm: "gzip",
                include: [/dist/],
                pathMapper: (assetPath) => assetPath.replace("dist/", ""),
            }),
        );
    } else {
        plugins.push(
            new CopyPlugin({
                patterns: [
                    { from: "src/i18n/", to: "./i18n/" },
                ],
            }),
        );
    }
    return {
        mode: argv.mode || "development",
        watch: !production,
        devtool: production ? false : "eval-source-map",
        entry: {
            [production ? "dist/index" : "index"]: "./src/index.ts",
        },
        output: {
            filename: "[name].js",
            path: path.resolve(__dirname),
            libraryTarget: "commonjs2",
            library: { type: "commonjs2" },
        },
        externals: {
            siyuan: "siyuan",
        },
        resolve: {
            extensions: [".ts", ".js", ".json"],
        },
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    include: [path.resolve(__dirname, "src")],
                    use: [
                        {
                            loader: "ts-loader",
                            options: { transpileOnly: true },
                        },
                    ],
                },
                {
                    test: /\.scss$/,
                    include: [path.resolve(__dirname, "src")],
                    use: [
                        MiniCssExtractPlugin.loader,
                        { loader: "css-loader" },
                        { loader: "sass-loader" },
                    ],
                },
            ],
        },
        plugins,
    };
};
