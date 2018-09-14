class MapData {
    constructor(seed, params) {
        seed = seed || (new Date()).getTime();
        randomSeed(seed);

        // I don't know WHAT the deal is with p5 noise() so we're using this instead
        var gen = new SimplexNoise(random);
        this.get_noise = function (nx, ny) {
          // Rescale from -1.0:+1.0 to 0.0:1.0
          return gen.noise2D(nx, ny) / 2 + 0.5;
        };

        // ----- Controls -------------\\
        this.elevation_range = float(params.elevationrange) || 1.5; // increase for a smaller elevation range
        this.elevation_scale = 3; // increase for more variation in elevation across the map
        this.elevation_noisiness = 3; // increase for less smooth elevation boundaries

        // roads
        this.min_segment_length = int(params.min) || 10;
        this.snap_radius = int(params.snap || this.min_segment_length * 0.95); // connect trailing roads to nearby roads
        this.max_segment_length = int(params.max) || 50;
        this.perterbation = float(params.perterbation || 0); // angle range for roads

        // parks
        this.park_threshold = float(params.park) || 0.08;
        this.beach_radius = float(params.beach) || 0.5;

        // ----- Map components ------------\\
        this.elevation = this.create_matrix();
        this.coastline = [];
        this.ocean = this.create_matrix();
        this.parks = this.create_matrix();
        this.beach = this.create_matrix();
        // tracks if the river succeeds
        this.has_river = true;
        this.riverline = [];
        this.river = this.create_matrix();
        this.river_width = float(params.riverwidth) || 1;// should be between 0.7 and 1.2
        this.population_density = this.create_matrix();
        this.neighborhoods = this.create_matrix();
        this.population_peaks = [];
        this.roads = [];
        this.roads_cmqtt = new ConnorMouseQuadtreeTree(0, 0, width, height);
    }

    compute_map() {
        // ----- compute elements ----- \\
        this.add_elevation();
        this.add_ocean();
        this.add_river();
        this.add_population_density();
        this.add_parks();
        this.add_neighborhoods();
        this.add_roads();

        return {
            elevation: this.elevation,
            coastline: this.coastline,
            ocean: this.ocean,
            riverline: this.riverline,
            has_river: this.has_river,
            river: this.river,
            parks: this.parks,
            beach: this.beach,
            population_density: this.population_density,
            population_peaks: this.population_peaks,
            neighborhoods: this.neighborhoods,
            neighborhood_centers: this.neighborhood_centers,
            roads: this.merged_roads,
            roads_cmqtt: this.roads_cmqtt,
        };

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
        console.log('elevation map', (end_time - start_time) / 1000);
    }

    get_river(x, y) {
        // check if a point is in the river or not
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

        this.roads = [];
        for (var i = 0; i < this.population_peaks.length; i++) {
            var peak = this.population_peaks[i];
            var road = [peak, {x: peak.x + 1, y: peak.y + 1}];
            this.roads.push(road);
            this.continue_road(road, this.max_segment_length);
        }

        var end_time = new Date();
        console.log('adding roads', (end_time - start_time) / 1000);

        var start_time = new Date();
        this.merged_roads = {};
        for (var i = 0; i < this.roads.length; i++) {
            if (this.roads[i].hasOwnProperty('id')) continue;
            this.follow_road(this.roads[i], i);
        }
        // convert dict to array
        this.merged_roads = Object.values(this.merged_roads);
        var end_time = new Date();
        console.log('merging roads', (end_time - start_time) / 1000);
    }

    follow_road(segment, id) {
        segment.id = id;
        if (!this.merged_roads[id]) this.merged_roads[id] = [segment];
        var match = undefined;
        // find all adjoining segments
        for (var j = 0; j < this.roads.length; j++) {
            var touchpoint = this.segments_touch(segment, this.roads[j]);
            if (!this.roads[j].hasOwnProperty('id') && !!touchpoint) {
                var angle = this.get_corner_angle(touchpoint[0], touchpoint[1], touchpoint[2]);
                if (angle > (3 * PI / 4) && angle < (5 * PI / 4)) {
                    match = [this.roads[j], touchpoint];
                    this.merged_roads[id].push(match[0]);
                    break;
                }
            }
        }
        if (!match) return;

        this.follow_road(match[0], id);
    }

    get_corner_angle(p1, p2, p3) {
        /*      p1
        /       /|
        /   b /  | a
        /   /A___|
        / p2   c  p3
        */

        var a = get_distance(p3, p1);
        var b = get_distance(p1, p2);
        var c = get_distance(p2, p3);

        return Math.acos(((b ** 2) + (c ** 2) - (a ** 2)) / (2 * b * c));
    }

    segments_touch(s1, s2) {
        for (var i = 0; i < s1.length; i += s1.length - 1) {
            for (var j = 0; j < s2.length; j += s2.length - 1) {
                var i_offset = i == 0 ? 1 : -1;
                var j_offset = j == 0 ? 1 : -1;
                if (get_distance(s1[i], s2[j]) < 2) {
                    if (i_offset == -1) {
                        return [s1[i + i_offset], s1[i], s2[j + j_offset]];
                    } else {
                        return [s2[j + j_offset], s1[i], s1[i + i_offset]]
                    }
                }
            }
        }
        return false;
    }

    get_theta(p1, p2) {
        return atan2(p1.y - p2.y, p1.x - p2.x);
    }

    continue_road(road, segment_length, count) {
        if (count === undefined) count = 1;

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
        var new_road = [road[ultimate], next.match];
        this.roads.push(new_road);
        if (!next.end) {
            this.continue_road(new_road, segment_length, count + 1);
        }
        return road;
    }

    next_road_segment(point, distance, theta, perterbation) {
        // find a suitable continuation point
        var options = [];
        // check an arc around the segment for an eligible point
        for (var a = theta - perterbation; a <= theta + perterbation; a += PI / 24) {
            var x = Math.round(point.x + (distance * cos(a)));
            var y = Math.round(point.y + (distance * sin(a)));

            var create_bridge = random() > (1 - (this.get_population_density(point.x, point.y) * 0.5));
            // try to make bridges
            if (this.get_river(x, y) && create_bridge) {
                var bridge_length = distance;
                var closest_river_center = this.get_best_fit(point, this.riverline, get_distance).match;
                var bridge_theta = atan2(closest_river_center.y - point.y, closest_river_center.x - point.x);

                while (this.get_river(x, y)) {
                    x = Math.round(point.x + (bridge_length * cos(bridge_theta)));
                    y = Math.round(point.y + (bridge_length * sin(bridge_theta)));
                    bridge_length++;
                }
                // ???
                bridge_length += 7;
                x = Math.round(point.x + (bridge_length * cos(bridge_theta)));
                y = Math.round(point.y + (bridge_length * sin(bridge_theta)));
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
        };
        var match = this.get_best_fit(point, options, fit_function);

        // check all the existing roads for options to merge within the radius
        var snap_matches = [];
        for (var r = this.roads.length - 1; r >= 0; r--) {
            var closest = this.get_best_fit(match.match, this.roads[r], get_distance);
            // check every point on the road to see if it's within the snap radius and not the original point
            for (var p = 0; p < this.roads[r].length; p++) {
                var proposed = this.roads[r][p];
                var segment_dist = get_distance(point, proposed); // how long the segment would be
                var snap_dist = get_distance(match.match, proposed); // how far from the originally proposed point
                if (snap_dist < this.snap_radius) {
                    snap_matches.push(proposed);
                }
            }
        }
        var best_snap_fit = this.get_best_fit(match.match, snap_matches, get_distance);
        if (best_snap_fit) {
            if (get_distance(point, best_snap_fit.match) < this.min_segment_length) {
                return {'match': false, 'end': true};
            }
            return {'match': best_snap_fit.match, 'end': true};
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
        return this.roads_cmqtt.query(cmqtt_segment, 0).length === 0;
    }

    validate_road_point(segment) {
        var x = segment[1].x;
        var y = segment[1].y;
        if (this.is_water(x, y, 3) || !this.on_map(x, y) || (this.parks[x][y] && random() > 0.4) || this.beach[x][y]) {
            return false;
        }

        var cmqtt_segment = new Segment(segment[0], segment[1]);
        return this.roads_cmqtt.query(cmqtt_segment, 0).length === 0;
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
            var distance = fit_function.call(this, option, point);
            if (distance !== 0 && (!closest || distance < closest[1])) {
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
        };
    }

    add_population_density() {
        var start_time = new Date();

        // simple simplex noise to set peaks
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                if (this.is_water(x, y)) {
                    this.population_density[x][y] = -1;
                    continue;
                }
                // higher number -> "zoom out"
                var frequency = this.elevation_scale / width;

                var nx = x * frequency - 0.5;
                var ny = y * frequency - 0.5;

                var modifier = 1 - ((Math.abs(x - (width * 0.5)) / width) + ((Math.abs(y - (height * 0.5)))) / height);
                var noise_value = this.get_noise(nx, ny) * modifier;

                this.population_density[x][y] = noise_value;
            }
        }
        var end_time = new Date();
        console.log('set population density', (end_time - start_time) / 1000);

        var start_time = new Date();
        this.population_peaks = [];
        var radius = 1;
        // find the local maxima of the noise
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
        this.city_center = this.population_peaks[0];
        for (var i = 0; i < this.population_peaks.length; i++) {
            if (!this.on_edge(this.population_peaks[i].x, this.population_peaks.y)) {
                this.city_center = this.population_peaks[i];
                break;
            }
        }
        var end_time = new Date();
        console.log('find local maxima', (end_time - start_time) / 1000);
    }

    add_neighborhoods() {
        var start_time = new Date();
        var centroids = [];
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                // this.ocean also includes the coastline, is_water has rivers, which we don't want here
                if (this.ocean[x][y] && this.is_water(x, y)) {
                    continue;
                }
                // find the closest neighborhood to this point
                var match = this.get_best_fit({x, y}, this.population_peaks, get_distance);
                var hood_index = match.index;
                this.neighborhoods[x][y] = hood_index;
                // centroids for lloyd relaxation
                if (!centroids[hood_index]) {
                    centroids[hood_index] = {
                        x_sum: x,
                        y_sum: y,
                        count: 1,
                    };
                } else {
                    centroids[hood_index].x_sum += x;
                    centroids[hood_index].y_sum += y;
                    centroids[hood_index].count++;
                }
            }
        }
        this.neighborhood_centers = [];
        for (var i = 0; i < centroids.length; i++) {
            var centroid = centroids[i];
            this.neighborhood_centers.push({x: centroid.x_sum / centroid.count, y: centroid.y_sum / centroid.count});
        }
        var end_time = new Date();
        console.log('designate neighborhoods', (end_time - start_time) / 1000);
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
        if (random() > 0.3) {
            var start = this.find_axis_low(0, 0, 'y', height / 2);
        } else {
            var start = this.find_axis_low(0, 0, 'x', width / 4);
        }
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
            if (max_x === undefined || point.x > max_x) {
                max_x = Math.round(point.x);
            }
            if (min_y === undefined || point.y < min_y) {
                min_y = Math.round(point.y);
            }
            if (max_y === undefined || point.y > max_y) {
                max_y = Math.round(point.y);
            }
        }
        var end_time = new Date();
        console.log('select river midpoints', (end_time - start_time) / 1000);

        var start_time = new Date();
        // dig out the riverbed
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                // find the closest point on the riverline to x,y
                var match = this.get_best_fit({x, y}, this.riverline, get_distance);
                // lower the elvation at this point relative to the distance from the closest riverline point
                // using elevation range keeps the width of the river proportional across maps
                this.elevation[x][y] -= 4 / ((match.distance + 0.00001) ** (this.elevation_range * this.river_width));
                if (this.get_elevation(x, y) < 0 && !this.ocean[x][y]) {
                    this.river[x][y] = true;
                }
            }
        }
        var end_time = new Date();
        console.log('dig out river', (end_time - start_time) / 1000);
    }

    graded_elevation(x, y) {
        // finds the elevation at a point with a gradiant applied so that the
        // NW corner is the highest
        return this.elevation[x][y] + ((height - y) + (1.2 * (width - x))) / (height + width);
    }

    add_parks() {
        var start_time = new Date();
        var beach_point = this.coastline[int(random(0, this.coastline.length))];
        var beach_radius = this.beach_radius * width;
        beach_point.x += beach_radius * 0.7;
        beach_point.y += beach_radius * 0.7;
        // let's just turn some mountaintops and unpopulated areas into parks, and toss some beaches in
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                if (this.get_population_density(x, y) < this.park_threshold || this.get_elevation(x, y) > (0.2 + this.park_threshold)) {
                    this.parks[x][y] = true;
                }
                if (this.ocean[x][y] && this.get_elevation(x, y) < 0.03 && get_distance({x, y}, beach_point) < beach_radius) {
                    this.beach[x][y] = true;
                }
            }
        }
        var end_time = new Date();
        console.log('add parks', (end_time - start_time) / 1000);
    }

    add_ocean() {
        // adds an ocean to the SE corner of the map
        var start_time = new Date();
        var start = this.find_axis_low(width / 16, height - 1, 0, 5 * width / 8);
        var end = this.find_axis_low(width - 1, height / 16, 1, height / 2);

        // follow the terrain using displaced midline algorithm
        this.coastline = this.displace_midpoint([start, end], {
            offset_denominator: 5, offset_balance: 0.01, min_segment_length: 10});

        // add the map's SE corner to complete the polygon
        this.coastline.push({x: width-1, y: height-1});
        this.coastline.splice(0, 0, {x: width-1, y: height-1});

        // knowing the smallest coord means an easier elevation computation below
        var min_x;
        var min_y;
        for (var i = 0; i < this.coastline.length; i++) {
            var point = this.coastline[i];
            if (min_x === undefined || point.x < min_x) {
                min_x = Math.round(point.x);
            }
            if (min_y === undefined || point.y < min_y) {
                min_y = Math.round(point.y);
            }
        }
        var end_time = new Date();
        console.log('set coastline', (end_time - start_time) / 1000);

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
        var low = {
            point: {x, y},
            elevation: 1
        }; // the lowest elevation point found in range
        var cp = {x, y}; // stores the current point being investigated

        for (var i = 0; i < range; i++) {
            cp[axis] += 1;
            if (!this.on_map(cp.x, cp.y)) {
                break;
            }
            var current_elevation = this.get_elevation(cp.x, cp.y);
            if (current_elevation < low.elevation) {
                low.point = cp;
                low.elevation = current_elevation;
            }
        }
        return low.point;
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
}

