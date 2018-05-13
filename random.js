const seedrandom = require('seedrandom');

class Random {
    constructor(seed) {
        this.random = seedrandom(seed);
    }

    seed(seed_chars) {
        this.random = seedrandom(seed);
    }

    random() {
        return Math.random()
    }
}

module.exports = Random;
