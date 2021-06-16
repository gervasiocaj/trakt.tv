module.exports = {
    module: {
        rules: [
            {
                test: /methods\.json$/i,
                type: "asset/resource",
            },
        ],
    },
    resolve: {
        fallback: {
            "buffer": require.resolve("buffer/"),
            "crypto": require.resolve("crypto-browserify"),
        },
    },
    entry: {
       trakt: './trakt.js',
    },
    mode: 'production',
    devtool: 'source-map',
    output: {
        filename: '[name].min.js',
        assetModuleFilename: '[file]',
        library: 'Trakt',
        libraryTarget: 'umd',
        globalObject: 'this',
        clean: true,
    },
};
