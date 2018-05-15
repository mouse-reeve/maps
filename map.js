var black;
var white;

function setup() {
    var container = document.getElementById('map');
    var canvas = createCanvas(1165, 600);
    canvas.parent(container);

    // parse URL get params
    var param_string = window.location.search.substr(1).split('&');
    var params = {};
    for (var i = 0; i < param_string.length; i++) {
        var pair = param_string[i].split('=');
        params[pair[0]] = pair[1];
    }
    var seed = params.seed || Math.floor(Math.random() * 10000);
    var layer = params.layer || 'topo';
    console.log(seed)

    // establish color globals now that things are initialized
    black = color(0);
    white = color(255);

    var map = new Map(seed, params);
    map.draw_map(layer);

    noLoop();
}

class Map {
    constructor(seed, params) {
        seed = seed || (new Date).getTime();
        randomSeed(seed);

        // I don't know WHAT the deal is with p5 noise() so we're using this instead
        var gen = new SimplexNoise(random);
        this.get_noise = function (nx, ny) {
          // Rescale from -1.0:+1.0 to 0.0:1.0
          return gen.noise2D(nx, ny) / 2 + 0.5;
        }

        // ----- Controls -------------\\
        this.elevation_range = 1.5; // increase for a smaller elevation range
        this.elevation_scale = 3; // increase for more variation in elevation across the map
        this.elevation_noisiness = 3; // increase for less smooth elevation boundaries

        // roads
        this.snap_radius = int(params.snap || 6); // connect trailing roads to nearby roads
        this.min_segment_length = int(params.min) || 5;
        this.max_segment_length = int(params.max) || 50;
        this.perterbation = float(params.perterbation || 0); // angle range for roads

        // ----- Map components ------------\\
        this.elevation = this.create_matrix();
        this.coastline = [];
        this.ocean = this.create_matrix();
        // tracks if the river succeeds
        this.has_river = true;
        this.riverline = [];
        this.river = this.create_matrix();
        this.population_density = this.create_matrix();
        this.population_peaks = [];
        this.roads = [];
        this.roads_cmqtt = new ConnorMouseQuadtreeTree(0, 0, width, height);
    }

    draw_map(layer) {
        // ----- compute elements ----- \\
        this.add_elevation();
        this.add_ocean();
        this.add_river();
        this.add_population_density();
        this.add_roads();

        // ----- draw map ------------- \\
        if (layer.indexOf('topo') > -1) {
            this.draw_topo();
        } else if (layer.indexOf('population') > -1) {
            this.draw_population();
        } else if (layer.indexOf('urban') > -1) {
            this.draw_urban();
        } else if (layer.indexOf('cmqtt') > -1) {
            this.draw_cmqtt();
        }
        if (layer.indexOf('roads') > -1) {
            this.draw_roads();
        }

        /* Handy for debugging the coast algorithms
        push();
        noFill();
        for (var i = 0; i < this.coastline.length; i++) {
            ellipse(this.coastline[i][0], this.coastline[i][1], 5, 5);
        }
        pop()
        */

        /* for debugging rivers
        push();
        for (var i = 0; i < this.riverline.length; i++) {
            fill((i/this.riverline.length) * 255);
            ellipse(this.riverline[i][0], this.riverline[i][1], 10, 10);
        }
        pop()
        */
        /* for debugging neighborhoods
        push();
        for (var i = 0; i < this.population_peaks.length; i++) {
            fill((i/this.population_peaks.length) * 255);
            ellipse(this.population_peaks[i].x, this.population_peaks[i].y, 10, 10);
        }
        pop()
        */

        this.compass_rose();
        this.draw_scale();
    }

    draw_cmqtt(tree) {
        // visualizer for debugging the ConnorMouseQuadtreeTree data strucutre
        tree = tree || this.roads_cmqtt;
        // traverse cmqtt to get all the rects and segments
        push();
        noFill();
        stroke(black);
        rect(tree.x, tree.y, tree.width, tree.height);
        pop()
        for (var c = 0; c < tree.children.length; c++) {
            if (tree.children[c] instanceof ConnorMouseQuadtreeTree) {
                this.draw_cmqtt(tree.children[c]);
            } else {
                line(tree.children[c].p1.x, tree.children[c].p1.y, tree.children[c].p2.x, tree.children[c].p2.y);
            }
        }
    }

    draw_population() {
        // density map
        var color_gap = 5;
        var colors = {
            water: '#A9DCE0',
        };
        push();
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                var point_color;
                if (this.is_water(x, y)) {
                    point_color = colors.water;
                } else {
                    point_color = 255 - (255 * this.get_population_density(x, y));
                    point_color = point_color > 255 ? 255 : point_color;
                    point_color = point_color < 0 ? 0 : point_color;
                    point_color += point_color * 0.1;
                }
                stroke(point_color, point_color, 255);
                point(x, y);
            }
        }
        pop();
    }

    draw_topo() {
        // topo map
        var color_gap = 5;
        var colors = {
            water: '#A9DCE0',
            topo: ['#C1CCA5', '#C1CCA5', '#E6F0BF', '#E9EFB5', '#DAC689', '#CDA37F', '#CB9082', '#C8BEC6', '#D6D5E5'],
        };
        push();
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                var point_color;
                if (this.get_elevation(x, y) < 0) {
                    point_color = colors.water;
                } else {
                    // bucketize for topo map
                    var value = Math.floor(this.get_elevation(x, y) * 100);
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
        pop();
    }

    topo_border(x, y) {
        // checks if a point is in a different elevation "bucket" than its SE neighbors
        var granularity = 50;
        for (var i = 0; i <= 1; i++) {
            for (var j = 0; j <= 1; j++) {
                if (this.on_map(x + i, y + j)) {
                    var elev1 = Math.floor(this.get_elevation(x, y) * granularity);
                    var elev2 = Math.floor(this.get_elevation(x + i, y + j) * granularity);
                    if (elev1 != elev2) {
                        return [this.get_elevation(x, y), this.get_elevation(x + i, y + j)];
                    }
                }
            }
        }
        return false;
    }

    draw_urban() {
        // topo map
        var color_gap = 5;
        var colors = {
            water: '#AADBFF',
            ground: '#E8E8E8',
            road_shadow: '#E5E5E5',
            road: '#FFFFFF',
        };
        push();
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                var point_color = this.get_elevation(x, y) < 0 ? colors.water : colors.ground;
                stroke(point_color);
                point(x, y);
            }
        }
        pop();
        this.draw_roads(colors);
    }

    draw_roads(colors) {
        push();
        strokeWeight(3);
        if (colors !== undefined) {
            stroke(colors.road);
        }
        if (colors !== undefined) {
            for (var i = 0; i < this.roads.length; i++) {
                var road = this.roads[i];
                var segment_length = get_distance(road[road.length - 2], road[road.length - 1]);
                var road_width = segment_length < this.min_segment_length * 2 ? 2 : 3;
                for (var j = 0; j < road.length - 1; j++) {
                    push();
                    stroke(colors.road_shadow);
                    strokeCap(SQUARE);
                    strokeWeight(road_width + 2);
                    line(road[j].x, road[j].y, road[j + 1].x, road[j + 1].y);
                    pop();
                }
            }
        }
        for (var i = 0; i < this.roads.length; i++) {
            if (colors === undefined) {
                stroke((i/this.roads.length) * 200);
            }
            var road = this.roads[i];
            var segment_length = get_distance(road[road.length - 2], road[road.length - 1]);
            var road_width = segment_length < this.min_segment_length * 2 ? 2 : 3;
            strokeWeight(road_width);
            for (var j = 0; j < road.length - 1; j++) {
                line(road[j].x, road[j].y, road[j + 1].x, road[j + 1].y);
            }
        }
        pop();
    }


    add_elevation() {
        // uses simplex noise to create an elevation matrix
        var start_time = new Date();
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
                noise_value = Math.pow(noise_value, this.elevation_range); // flattens out the lows

                this.elevation[x][y] = noise_value;
            }
        }
        var end_time = new Date();
        console.log('elevation map', (end_time - start_time) / 1000)
    }

    get_river(x, y) {
        // making this a function so that it can be swapped out or used
        // with elevation modifiers
        x = Math.round(x);
        y = Math.round(y);
        if (this.on_map(x, y)) {
            return this.river[x][y];
        }
    }

    get_elevation(x, y) {
        // making this a function so that it can be swapped out or used
        // with elevation modifiers
        x = Math.round(x);
        y = Math.round(y);
        if (this.on_map(x, y)) {
            return this.elevation[x][y];
        }
    }

    add_roads() {
        var start_time = new Date();

        for (var i = -1; i <= 1; i += 2) {
            for (var j = -1; j <= 1; j += 2) {
                var road = [this.city_center, {x: this.city_center.x + i, y: this.city_center.y + j}];
                this.roads.push(road);
                this.continue_road(road, this.max_segment_length);
            }
        }

        var end_time = new Date();
        console.log('adding roads', (end_time - start_time) / 1000)
    }

    continue_road(road, segment_length, count) {
        if (count == undefined) count = 1;

        if (segment_length < this.min_segment_length) {
            return;
        }

        // add to and/or fork off new road roads
        var road_perterbation = this.perterbation;
        var fork_perterbation = this.perterbation / 2;

        var penultimate = road.length - 2;
        var ultimate = road.length - 1;

        var theta = atan2(road[ultimate].y - road[penultimate].y, road[ultimate].x - road[penultimate].x);

        // ----- branch from the road in both directions
        var decrement = random(0.5, 1.1);
        for (var i = -1; i <= 1; i += 2) {
            // perpendicular slope
            var perpendicular_theta = theta + (i * HALF_PI);
            var fork_next = this.next_road_segment(road[ultimate], decrement * segment_length, perpendicular_theta, fork_perterbation);
            if (fork_next.match) {
                var fork = [road[ultimate], fork_next.match];
                // track the new segment in the cmqtt data strucutre for efficient lookup later
                var cmqtt_segment = new Segment(road[ultimate], fork_next.match);
                this.roads_cmqtt.insert(cmqtt_segment);
                // a branch has been added
                this.roads.push(fork);
                if (!fork_next.end) {
                    this.continue_road(fork, segment_length * decrement, count + 1);
                }
            }
        }

        // ----- continue the road
        var next = this.next_road_segment(road[ultimate], segment_length, theta, road_perterbation);

        // terminate roads that are in water or off the map
        if (!next.match) {
            return;
        }
        var cmqtt_segment = new Segment(road[ultimate], next.match);
        this.roads_cmqtt.insert(cmqtt_segment);
        road.push(next.match);
        if (!next.end) {
            this.continue_road(road, segment_length, count + 1);
        }
        return road
    }

    next_road_segment(point, distance, theta, perterbation) {
        // find a suitable continuation point

        var options = []
        for (var a = theta - perterbation; a <= theta + perterbation; a += PI / 24) {
            var x = point.x + (distance * cos(a));
            var y = point.y + (distance * sin(a));
            // try to make bridges
            var create_bridge = random() > 1 - (this.get_population_density(point.x, point.y) * 0.1);
            if (this.on_map(x, y) && this.get_river(x, y) && create_bridge) {
                // maybe make a bridge
                var bridge_length = distance;
                while (this.get_river(x, y)) {
                    x = point.x + (bridge_length * cos(a));
                    y = point.y + (bridge_length * sin(a));
                    bridge_length++;
                }
                bridge_length += 7;
                x = point.x + (bridge_length * cos(a));
                y = point.y + (bridge_length * sin(a));
                if (bridge_length < this.max_segment_length && this.validate_bridge_point([point, {x, y}])) {
                    options.push({x, y});
                }
            } else if (this.validate_road_point([point, {x, y}])) {
                options.push({x, y});
            }
        }
        if (options.length < 1) {
            return {'match': false, 'end': true};
        }

        var fit_function = function(p1, p2) {
            // needs to return smaller values for more desirable results, and we want least elevation change
            return Math.abs(this.get_elevation(p1.x, p1.y) - this.get_elevation(p2.x, p2.y));
        }
        var match = this.get_best_fit(point, options, fit_function);

        // check all the roads for options within the radius
        for (var r = this.roads.length - 1; r >= 0; r--) {
            var closest = this.get_best_fit(match.match, this.roads[r], get_distance);
            if (closest.distance < this.snap_radius) {
                return {'match': closest.match, 'end': true};
            }
        }

        return {
            'match': match.match,
            'end': false,
        };
    }

    validate_bridge_point(segment) {
        var x = segment[1].x;
        var y = segment[1].y;
        if (!this.on_map(x, y)) {
            return false;
        }

        var cmqtt_segment = new Segment(segment[0], segment[1]);
        return this.roads_cmqtt.query(cmqtt_segment, 0).length == 0
    }

    validate_road_point(segment) {
        var x = segment[1].x;
        var y = segment[1].y;
        if (this.is_water(x, y, 3) || !this.on_map(x, y)) {
            return false;
        }

        var cmqtt_segment = new Segment(segment[0], segment[1]);
        return this.roads_cmqtt.query(cmqtt_segment, 0).length == 0
    }

    get_best_fit(point, options, fit_function) {
        // compare a point to a set of other points to find the best fit
        var closest;
        for (var i = 0; i < options.length; i++) {
            var option = options[i];
            if (!option) {
                // handles arrays with deleted entries set to undefined
                continue;
            }
            var distance = fit_function.call(this, option, point)
            if (distance != 0 && (!closest || distance < closest[1])) {
                closest = [option, distance, i];
            }
        }
        if (!closest) {
            return false;
        }
        return {
            'match': closest[0],
            'distance': closest[1],
            'index': closest[2]
        }
    }

    add_population_density() {
        // simplex noise that is centered around a downtown peak
        var start_time = new Date();
        var river_center = this.riverline[int(this.riverline.length / 2)];
        var x = river_center.x;
        var y = river_center.y
        while (this.is_water(x, y)) {
            y += 1;
        }
        y += 20; // remove the city center enough from the river that it's out of the waterline radius

        var longest = Math.sqrt(width ** 2 + height ** 2);
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                if (this.is_water(x, y)) {
                    this.population_density[x][y] = -1;
                    continue
                }
                // higher number -> "zoom out"
                var frequency = this.elevation_scale / width;

                var nx = x * frequency - 0.5;
                var ny = y * frequency - 0.5;

                var noise_value = this.get_noise(nx, ny);

                this.population_density[x][y] = noise_value;
            }
        }
        var end_time = new Date();
        console.log('set population density', (end_time - start_time) / 1000)

        var start_time = new Date();
        this.population_peaks = [];
        var radius = 1;
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                if (this.is_water(x, y)) {
                    continue;
                }
                var angle = TWO_PI / 10;
                var higher = true;
                for (var a = 0; a < TWO_PI; a += angle) {
                    var ix = x + radius * cos(a);
                    var iy = y + radius * sin(a);
                    if (this.get_population_density(x, y) < this.get_population_density(ix, iy) || this.is_water(ix, iy)) {
                        higher = false;
                        break;
                    }
                }
                if (higher) {
                    var point = {x, y};
                    point.density = this.get_population_density(x, y);
                    this.population_peaks.push(point);
                }
            }
        }
        this.population_peaks.sort(function (a, b) { return a[2] > b[2] ? -1 : 1; });
        this.city_center = this.population_peaks[0]
        var end_time = new Date();
        console.log('find local maxima', (end_time - start_time) / 1000)
    }

    get_population_density(x, y) {
        x = Math.round(x);
        y = Math.round(y);
        if (this.on_map(x, y)) {
            return this.population_density[x][y];
        }
    }

    is_water(x, y, radius) {
        if (radius) {
            for (var a = 0; a < TWO_PI; a += PI / 6) {
                for (var r = 0; r < radius; r++) {
                    var nx = x + r * cos(a);
                    var ny = y + r * sin(a);
                    if (this.get_elevation(nx, ny) < 0) {
                        return true;
                    }
                }
            }
        }
        return this.get_elevation(x, y) < 0;
    }

    add_river() {
        // adds a river that runs from the NW corner
        var segment_length = 50;
        var start = this.find_axis_low(0, 0, 1, height / 2);
        this.riverline = [start, {x: start.x + 1, y: start.y}];

        // use graded elevation
        this.real_elevation = this.get_elevation;
        this.get_elevation = this.graded_elevation;

        var success = false;
        var i = 1;
        var max_points = 200;
        while (i < max_points) {
            // define a 2PI/3 degree arc "line of sight" from the previous point
            var vision_range = TWO_PI / 3;
            var start_angle = PI + atan2((this.riverline[i].y - this.riverline[i - 1].y), (this.riverline[i].x - this.riverline[i - 1].x)) + vision_range;

            var lowest = [{}, height * width];
            // evaluate every point on the arc for the lowest elevation
            for (var a = start_angle; a < start_angle + vision_range; a += PI / 20) {
                var sx = Math.round(this.riverline[i].x + (segment_length * cos(a)));
                var sy = Math.round(this.riverline[i].y + (segment_length * sin(a)));

                if (this.on_map(sx, sy) && this.get_elevation(sx, sy) < lowest[1]) {
                    // check for self-intersection
                    var intersecting = false;
                    // these look 3x further ahead to check for intersection
                    var ix = Math.round(this.riverline[i].x + (3 * segment_length * cos(a)));
                    var iy = Math.round(this.riverline[i].y + (3 * segment_length * sin(a)));
                    for (var r = 0; r < this.riverline.length - 2; r++) {
                        if (this.segment_intersection(this.riverline[i], {x: ix, y: iy}, this.riverline[r], this.riverline[r + 1])) {
                            intersecting = true;
                            break;
                        }
                    }
                    if (!intersecting) {
                        lowest = [{x: sx, y: sy}, this.get_elevation(sx, sy)];
                    }
                }
            }
            // the river has failed, there will be no river
            if (!lowest[0].x || !lowest[0].y) {
                break;
            }
            this.riverline.push(lowest[0]);

            // stop if the river hits the ocean or the edge of the map
            if (this.get_elevation(lowest[0].x, lowest[0].y) < 0 ||
                    sx > width - (segment_length * 0.3) ||
                    sy > height - (segment_length * 0.3) ||
                    (sy < segment_length * 0.3 && i > 15)) {
                success = true;
                // make sure the river hits the end of the map
                this.riverline.push({x: sx + segment_length, y: sy + segment_length});
                break;
            }
            i++;
        }
        this.get_elevation = this.real_elevation;

        if (!success) {
            this.has_river = false;
            return;
        }

        var start_time = new Date();
        // place points between the current path
        var river_detail = [];
        for (var r = 0; r < this.riverline.length - 1; r++) {
            var segment = [this.riverline[r], this.riverline[r + 1]];
            river_detail = river_detail.concat(this.displace_midpoint(segment,
                {offset_denominator: 5,
                 offset_balance: 0.5,
                 min_segment_length: 5}
            ));
        }
        this.riverline = river_detail;

        // store min/max coords
        var max_x;
        var min_y;
        var max_y;
        for (var i = 0; i < this.riverline.length; i++) {
            var point = this.riverline[i];
            if (max_x == undefined || point.x > max_x) {
                max_x = Math.round(point.x);
            }
            if (min_y == undefined || point.y < min_y) {
                min_y = Math.round(point.y);
            }
            if (max_y == undefined || point.y > max_y) {
                max_y = Math.round(point.y);
            }
        }
        var end_time = new Date();
        console.log('select river midpoints', (end_time - start_time) / 1000)

        var start_time = new Date();
        // dig out the riverbed
        var radius = 150;
        min_y = radius - 150 < 0 ? 0 : radius - 150;
        for (var y = min_y; y < (max_y + radius) && y < height; y++) {
            for (var x = 0; x < (max_x + radius) && x < width; x++) {
                // this starting distance is higher than the actual possible max
                var match = this.get_best_fit({x, y}, this.riverline, get_distance);
                this.elevation[x][y] -= 4 / ((match.distance + 0.00001) ** 1.5);
                if (this.get_elevation(x, y) < 0) {
                    this.river[x][y] = true;
                }
            }
        }
        var end_time = new Date();
        console.log('dig out river', (end_time - start_time) / 1000)
    }

    graded_elevation(x, y) {
        // finds the elevation at a point with a gradiant applied so that the
        // NW corner is the highest
        return this.elevation[x][y] + ((height - y) + (4 * (width - x))) / (height + width);
    }

    add_ocean() {
        // adds an ocean to the SE corner of the map
        var start_time = new Date();
        var start = this.find_axis_low(width / 16, height - 1, 0, 5 * width / 8);
        var end = this.find_axis_low(width - 1, height / 16, 1, height / 2);

        // follow the terrain using displaced midline algorithm
        this.coastline = this.displace_midpoint([start, end], {
            offset_denominator: 5, offset_balance: 0.2, min_segment_length: 10});

        // add the map's SE corner to complete the polygon
        this.coastline.push({x: width-1, y: height-1});
        this.coastline.splice(0, 0, {x: width-1, y: height-1});

        // knowing the smallest coord means an easier elevation computation below
        var min_x;
        var min_y;
        for (var i = 0; i < this.coastline.length; i++) {
            var point = this.coastline[i];
            if (min_x == undefined || point.x < min_x) {
                min_x = Math.round(point.x);
            }
            if (min_y == undefined || point.y < min_y) {
                min_y = Math.round(point.y);
            }
        }
        var end_time = new Date();
        console.log('set coastline', (end_time - start_time) / 1000)

        var start_time = new Date();
        // ray casting to determine which points are inside the coastline polygon
        for (var y = min_y; y < height; y++) {
            for (var x = min_x; x < width; x++) {
                // this starting distance is always higher than the actual possible max
                var distance = Math.pow(height, 2) + Math.pow(width, 2);
                var hits = [];
                // compare this point to all the edges in the coastline polygon
                for (var j = 0; j < this.coastline.length - 1; j++) {
                    // check if the ray from x, y to the border intersects the line defined by this.coastline[j] -> this.coastline[j + 1]
                    var result = this.segment_intersection(
                        {x, y}, {x: width, y: y},
                        this.coastline[j], this.coastline[j + 1]);

                    // while we're here, calculate the distance between this
                    // point and this spot on the coast, so we can change the
                    // elevation if necessary (closest line segment may not be
                    // the segment that the ray intersects)

                    // don't do this calculation with the final (corner) point
                    // because that's supposed to just be "out to sea"
                    if (j < this.coastline.length - 2) {
                        var h_distance = get_distance(this.coastline[j + 1], {x, y});
                        distance = h_distance < distance ? h_distance : distance;
                    }

                    if (result) {
                        hits.push({x: this.coastline[j], y: this.coastline[j + 1]});
                    }
                }
                // if there are an odd number of hits, then it's inside the ocean polygon
                if (hits.length % 2 == 1) {
                    // set the depth of this field relative to the distance
                    // from the coastline
                    this.elevation[x][y] -= (distance ** 2) / 10000;
                    this.ocean[x][y] = true;
                }
            }
        }
        var end_time = new Date();
        console.log('dig out ocean', (end_time - start_time) / 1000)
    }

    segment_intersection(p1, p2, p3, p4) {
        // check if two line segments intersect
        var threshold = 1;
        if (get_distance(p2, p3) < threshold) {
            return false;
        }

        var ccw = this.counterclockwise;
        return ccw(p1, p3, p4) != ccw(p2, p3, p4) && ccw(p1, p2, p3) != ccw(p1, p2, p4);
    }

    counterclockwise(a, b, c) {
        // utility function for determining if line segments intersect
        return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
    }

    find_axis_low(x, y, axis, range) {
        // utility function for picking lowpoints on the edges of the map
        var low = [{x, y}, 1]; // the lowest elevation point found in range
        var cp = {x, y}; // stores the current point being investigated

        for (var i = 0; i < range; i++) {
            cp[axis] += 1;
            if (!this.on_map(cp.x, cp.y)) {
                break;
            }
            var current_elevation = this.get_elevation(cp.x, cp.y);
            if (current_elevation < low.y) {
                low = [cp, current_elevation];
            }
        }
        return low[0];
    }


    displace_midpoint(curve, params) {
        // params must have offset_denominator, offset_balance, and min_segment_length
        // recursive algorithm to fit a line to the lows on the elevation map
        // params.offset_denominator controls how far the midpoint can vary
        // (higher denom -> less variation)
        // params.offset_balance controls whether it prefers to look above or below
        // the line (useful for coastline); 0.5 is balanced
        if (!params.index_1 && !params.index_2) {
            // allow outside functions to call this with just the start/end points
            params.index_1 = 0;
            params.index_2 = 1;
        }
        var start = curve[params.index_1];
        var end = curve[params.index_2];
        var segment_length = get_distance(start, end);
        if (segment_length < params.min_segment_length) {
            return curve;
        }
        var midpoint = {x: Math.round((start.x + end.x) / 2),
                        y: Math.round((start.y + end.y) / 2)};

        // equation of the perpendicular line is y = mx + b
        var m = -1 * (start.x - end.x) / (start.y - end.y);
        var b = midpoint.y - (m * midpoint.x)
        var x = midpoint.x;
        var y;

        var optimal = [midpoint, this.get_elevation(midpoint.x, midpoint.y)];
        var offset = Math.round(segment_length / params.offset_denominator);
        var perpendicular_start = offset * (0 - params.offset_balance);
        var perpendicular_end = offset * (1 - params.offset_balance);

        // check for the lowest elevation along the perpendicular path
        for (var i = perpendicular_start; i < perpendicular_end; i++) {
            var nx = Math.round(x + (i / Math.abs(i)) * Math.sqrt(i ** 2 / (1 + m ** 2)));
            y = Math.round((m * nx) + b);
            if (!this.on_map(nx, y)) {
                continue;
            }
            var elevation = this.get_elevation(nx, y);
            if (elevation < optimal[1]) {
                optimal = [{x: nx, y: y}, elevation];
            }
        }
        var displaced = optimal[0];

        curve.splice(params.index_2, 0, displaced);

        // continue recursively with modified copies of the original params
        var right_params = Object.assign({}, params);
        right_params.index_1 = params.index_2;
        right_params.index_2 = params.index_2 + 1;
        curve = this.displace_midpoint(curve, right_params);

        return this.displace_midpoint(curve, params);
    }

    on_map(x, y) {
        // is the point on the map?
        return x >= 0 && y >= 0 && x < width && y < height;
    }

    on_edge(x, y) {
        return x == 0 || y == 0 || x >= width - 1 || y >= height - 1;
    }

    create_matrix() {
        // produces a map-sized matrix
        var matrix = [];
        for (var x = 0; x < width; x++) {
            matrix[x] = new Array(height);
        }
        return matrix;
    }

    draw_scale() {
        // draws the black and white scale indicator at the bottom of the map
        push();
        var r_height = 7;
        var r_width = 50;
        var offset = 220;

        stroke(black);
        textSize(9);

        var fill_color = black;
        text('0 miles', width - offset, height - 25);
        for (var i = 0; i < 4; i++) {
            fill_color = fill_color == white ? black : white;
            fill(fill_color);
            rect(width - offset, height - 20, r_width, r_height);
            offset -= 50;

            fill(black);
            var dist = (0.5 * (i + 1)).toString();
            // "2" -> "2.0"
            dist = (dist).replace(/^((?!0)\d)+(?!\.(?!\d))$/, '$1.0');
            text(dist, width - offset - 5, height - 25);
        }
        pop();
    }

    compass_rose() {
        // draws a simple compass rose
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

