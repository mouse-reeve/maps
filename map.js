var black;
var white;

function setup() {
    var container = document.getElementById('map');
    var canvas = createCanvas(800, 600);
    canvas.parent(container);

    var seed = container.getAttribute('data-seed');
    black = color(0);
    white = color(255);

    var map = new Map(seed);
    map.draw_map();

    noLoop();
}

class Map {
    constructor(seed) {
        seed = seed || (new Date).getTime();
        randomSeed(seed);

        // I don't know WHAT the deal is with p5 noise() so we're using this instead
        var gen = new SimplexNoise(random);
        this.get_noise = function (nx, ny) {
          // Rescale from -1.0:+1.0 to 0.0:1.0
          return gen.noise2D(nx, ny) / 2 + 0.5;
        }

        // ----- CONTROLS -------------\\
        this.beach_steepness = 0.005; // increase for steeper beaches
        this.elevation_range = 1.5; // increase for a smaller elevation range
        this.elevation_scale = 3; // increase for more variation in elevation across the map
        this.elevation_noisiness = 3; // increase for less smooth elevation boundaries

        // ----- BUILD MAP ------------\\
        this.elevation = this.create_matrix();
        this.water = this.create_matrix();
    }

    draw_map() {
        // ----- compute elements ----- \\
        this.get_elevation();
        this.get_coastline();

        var color_gap = 5;
        // ----- draw map ------------- \\
        // topo map
        var colors = {
            water: '#A9DCE0',
            topo: ['#C1CCA5', '#C1CCA5', '#E6F0BF', '#E9EFB5', '#DAC689', '#CDA37F', '#CB9082', '#C8BEC6', '#D6D5E5'],
        };
        push();
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                var point_color;
                if (!!this.water[x][y] || this.elevation[x][y] < 0) {
                    point_color = colors.water;
                } else {
                    // bucketize for topo map
                    var value = Math.floor(this.elevation[x][y] * 100);
                    var color_bucket = Math.floor(value / color_gap);
                    if (color_bucket >= colors.topo.length) {
                        color_bucket = colors.topo.length - 1;
                    }
                    point_color = colors.topo[color_bucket];

                    var border_value = this.topo_border(x, y);
                    if (!!border_value) {
                        var bucket1 = Math.floor(border_value[0] * 100 / color_gap);
                        var bucket2 = Math.floor(border_value[1] * 100 / color_gap);

                        point_color = bucket1 != bucket2 ? 0 : lerpColor(color(point_color), black, 0.3);
                    }
                }
                stroke(point_color);
                point(x, y);
            }
        }
        pop()

        /* Handy for debugging the coast algorithms
        push();
        noFill();
        for (var i = 0; i < this.coastline.length; i++) {
            ellipse(this.coastline[i][0], this.coastline[i][1], 5, 5);
        }
        pop()
        */

        this.compass_rose();
        this.draw_scale();
    }

    topo_border(x, y) {
        // checks if a point is in a different elevation "bucket" than its SE neighbors
        var granularity = 50;
        for (var i = 0; i <= 1; i++) {
            for (var j = 0; j <= 1; j++) {
                if (this.on_map(x + i, y + j)) {
                    var elev1 = Math.floor(this.elevation[x][y] * granularity);
                    var elev2 = Math.floor(this.elevation[x + i][y + j] * granularity);
                    if (elev1 != elev2) {
                        return [this.elevation[x][y], this.elevation[x + i][y + j]];
                    }
                }
            }
        }
        return false;
    }

    get_elevation() {
        // uses simplex noise to create an elevation matrix
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                // higher number -> "zoom out"
                var frequency = this.elevation_scale / width;

                var nx = x * frequency - 0.5;
                var ny = y * frequency - 0.5;

                // noisiness of edges
                var octaves = this.elevation_noisiness;

                var noise_value = 0;
                var divisor = 1;
                for (var i = 1; i <= octaves; i = i * 2) {
                    noise_value += 1 / i * this.get_noise(i * nx, i * ny);
                    divisor += 1 / i;
                }
                noise_value = noise_value / divisor; // keeps the value between 0 and 1
                noise_value = Math.pow(noise_value, this.elevation_range); // flatens out the lows

                this.elevation[x][y] = noise_value;
            }
        }
    }

    get_coastline() {
        // adds an ocean to the SE corner of the map

        var start = this.find_axis_low(width / 8, height - 1, 0, 5 * width / 8);
        var end = this.find_axis_low(width - 1, height / 8, 1, height / 2);

        // follow the terrain using displaced midline algorithm
        this.coastline = this.displace_midpoint(0, 1, [start, end]);

        // add the map's SE corner to complete the polygon
        this.coastline.push([width-1, height-1]);
        this.coastline.splice(0, 0, [width-1, height-1]);

        // ray casting to determine which points are inside the coastline polygon
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                // this starting distance is always higher than the actual possible max
                var distance = Math.pow(height, 2) + Math.pow(width, 2);
                var hits = [];
                // compare this point to all the edges in the coastline polygon
                for (var j = 0; j < this.coastline.length - 1; j++) {
                    // check if the ray from x, y to the border intersects the line defined by this.coastline[j] -> this.coastline[j + 1]
                    var ccw = this.counterclockwise;
                    var p1 = [x, y];
                    var p2 = [width, y];
                    var p3 = this.coastline[j];
                    var p4 = this.coastline[j + 1];
                    var result = ccw(p1, p3, p4) != ccw(p2, p3, p4) && ccw(p1, p2, p3) != ccw(p1, p2, p4);

                    // while we're here, calculate the distance between this
                    // point and this spot on the coast, so we can change the
                    // elevation if necessary (closest line segment may not be
                    // the segment that the ray intersects)

                    // don't do this calculation with the final (corner) point
                    // because that's supposed to just be "out to sea"
                    if (j < this.coastline.length - 2) {
                        var h_distance = Math.sqrt(Math.pow(p4[0] - x, 2) + Math.pow(p4[1] - y, 2));
                        distance = h_distance < distance ? h_distance : distance;
                    }

                    if (result) {
                        hits.push([this.coastline[j], this.coastline[j + 1]]);
                    }
                }
                // if there are an odd number of hits, then it's inside the ocean polygon
                if (hits.length % 2 == 1) {
                    // set the depth of this field relative to the distance
                    // from the coastine
                    this.elevation[x][y] -= this.beach_steepness * distance;
                }
            }
        }
    }

    counterclockwise(a, b, c) {
        // utility function for determining if line segments intersect
        return (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0]);
    }

    find_axis_low(x, y, axis, range) {
        // utility function for picking lowpoints on the edges of the map
        var low = [[x, y], 1]; // the lowest elevation point found in range
        var cp = [x, y]; // stores the current point being investigated

        for (var i = 0; i < range; i++) {
            cp[axis] += 1;
            if (!this.on_map(...cp)) {
                break;
            }
            var current_elevation = this.elevation[cp[0]][cp[1]];
            if (current_elevation < low[1]) {
                low = [[cp[0], cp[1]], current_elevation];
            }
        }
        return low[0];
    }

    displace_midpoint(i1, i2, curve) {
        var start = curve[i1];
        var end = curve[i2];
        var segment_length = Math.sqrt(Math.pow(end[0] - start[0], 2) + Math.pow(end[1] - start[1], 2));
        if (segment_length < 10) {
            return curve;
        }
        var midpoint = [Math.round((start[0] + end[0]) / 2),
                        Math.round((start[1] + end[1]) / 2)];

        // equation of the perpendicular line is y = mx + b
        var m = -1 * (start[0] - end[0]) / (start[1] - end[1]);
        // b = y - mx
        var b = midpoint[1] - (m * midpoint[0])
        var x = midpoint[0];
        var y;

        var low = [midpoint[0], midpoint[1], this.elevation[midpoint[0]][midpoint[1]]];

        var offset = Math.round(segment_length / 5);
        for (var i = offset * -0.2; i < offset * 0.8; i++) {
            var nx = Math.floor(x + i);
            y = Math.round((m * nx) + b);
            if (!this.on_map(nx, y)) {
                continue;
            }
            var elevation = this.elevation[nx][y];
            if (elevation < low[2]) {
                low = [nx, y, elevation];
            }
        }
        var displaced = [low[0], low[1]];

        curve.splice(i2, 0, displaced);
        curve = this.displace_midpoint(i2, i2 + 1, curve);
        return this.displace_midpoint(i1, i2, curve);
    }

    on_map(x, y) {
        // is the point on the map?
        return x >= 0 && y >= 0 && x < width && y < height;
    }

    create_matrix() {
        var matrix = [];
        for (var x = 0; x < width; x++) {
            matrix[x] = new Array(height);
        }
        return matrix;
    }

    draw_scale() {
        push();
        var r_height = 7;
        var r_width = 50;
        var offset = 220;

        stroke(black)
        textSize(9);

        fill(white);
        rect(width - offset, height - 20, r_width, r_height);
        fill(black);
        text('0 miles', width - offset, height - 25);
        offset -= 50;
        text('0.5', width - offset - 5, height - 25);

        fill(black);
        rect(width - offset, height - 20, r_width, r_height);
        offset -= 50;
        text('1.0', width - offset - 5, height - 25);

        fill(white);
        rect(width - offset, height - 20, r_width, r_height);
        offset -= 50;

        fill(black);
        text('1.5', width - offset - 5, height - 25);
        rect(width - offset, height - 20, r_width, r_height);
        offset -= 50;
        text('2.0', width - offset - 5, height - 25);
        pop();
    }

    compass_rose() {
        push();
        textSize(25);
        textFont('Georgia');
        fill(black);
        text('N', 20, height - 20);
        beginShape();
        vertex(22, height - 50);
        vertex(30, height - 80);
        vertex(38, height - 50);
        vertex(30, height - 60);
        endShape(CLOSE);
        pop();
    }
}


