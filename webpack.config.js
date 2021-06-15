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
            "buffer": false,
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
