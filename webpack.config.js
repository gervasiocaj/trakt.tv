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
    output: {
        filename: '[name].min.js',
        library: 'Trakt',
        libraryTarget: 'umd',
        globalObject: 'this',
        clean: true,
    },
};
