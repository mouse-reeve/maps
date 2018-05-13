const Random = require('./random')
const get_distance = require('./utilities')
var connormouse = require('./cmqttree')
var ConnorMouseQuadtreeTree = connormouse.ConnorMouseQuadtreeTree
var Segment = connormouse.Segment
var SimplexNoise = require('simplex-noise')
var random

class Map {
    constructor(seed, params) {
        seed = seed || (new Date).getTime()
        random = new Random(seed)
        console.log(seed);

        // I don't know WHAT the deal is with p5 noise() so we're using this instead
        var gen = new SimplexNoise(random.random)
        this.get_noise = function (nx, ny) {
          // Rescale from -1.0:+1.0 to 0.0:1.0
          return gen.noise2D(nx, ny) / 2 + 0.5
        }

        // ----- Controls -------------\\
        // canvas
        this.height = Number(params.height) || 500
        this.width = Number(params.width) || 500
        // topology
        this.elevation_range = 1.5 // increase for a smaller elevation range
        this.elevation_scale = 3 // increase for more variation in elevation across the map
        this.elevation_noisiness = 3 // increase for less smooth elevation boundaries

        // roads
        this.snap_radius = Number(params.snap || 20) // connect trailing roads to nearby roads
        this.min_segment_length = Number(params.min) || 15
        this.max_segment_length = Number(params.max) || 50
        this.perterbation = Number(params.perterbation || 0) // angle range for roads

        // ----- Map components ------------\\
        this.elevation = this.create_matrix()
        this.coastline = []
        this.ocean = this.create_matrix()
        // tracks if the river succeeds
        this.has_river = true
        this.riverline = []
        this.river = this.create_matrix()
        this.population_density = this.create_matrix()
        this.population_peaks = []
        this.roads = []
        this.roads_cmqtt = new ConnorMouseQuadtreeTree(0, 0, this.width, this.height)

        // ----- Actually compute everything ------ \\
        this.add_elevation()
        this.add_ocean()
        this.add_river()
        this.add_population_density()
        this.add_roads()

        return {
            'elevation': this.elevation,
            'has_river': this.has_river,
            'river': this.river,
            'ocean': this.ocean,
            'population': this.population_density,
            'roads': this.roads,
            'width': this.width,
            'height': this.height,
        }
    }



    add_elevation() {
        // uses simplex noise to create an elevation matrix
        var start_time = new Date()
        for (var y = 0; y < this.height; y++) {
            for (var x = 0; x < this.width; x++) {
                // higher number -> "zoom out"
                var frequency = this.elevation_scale / this.width

                var nx = x * frequency - 0.5
                var ny = y * frequency - 0.5

                // noisiness of edges
                var octaves = this.elevation_noisiness

                var noise_value = 0
                var divisor = 1
                for (var i = 1; i <= octaves; i = i * 2) {
                    noise_value += 1 / i * this.get_noise(i * nx, i * ny)
                    divisor += 1 / i
                }
                noise_value = noise_value / divisor // keeps the value between 0 and 1
                noise_value = Math.pow(noise_value, this.elevation_range) // flattens out the lows

                this.elevation[x][y] = noise_value
            }
        }
        var end_time = new Date()
        console.log('elevation map', (end_time - start_time) / 1000)
    }

    get_river(x, y) {
        // making this a function so that it can be swapped out or used
        // with elevation modifiers
        x = Math.round(x)
        y = Math.round(y)
        if (this.on_map(x, y)) {
            return this.river[x][y]
        }
    }

    get_elevation(x, y) {
        // making this a function so that it can be swapped out or used
        // with elevation modifiers
        x = Math.round(x)
        y = Math.round(y)
        if (this.on_map(x, y)) {
            return this.elevation[x][y]
        }
    }

    add_roads() {
        var start_time = new Date()

        for (var i = -1; i <= 1; i += 2) {
            for (var j = -1; j <= 1; j += 2) {
                var road = [this.city_center, {x: this.city_center.x + i, y: this.city_center.y + j}]
                this.roads.push(road)
                this.continue_road(road, this.max_segment_length)
            }
        }

        var end_time = new Date()
        console.log('adding roads', (end_time - start_time) / 1000)
    }

    continue_road(road, segment_length, count) {
        if (count == undefined) count = 1

        if (segment_length < this.min_segment_length) {
            return
        }
        // add to and/or fork off new road roads
        var road_perterbation = this.perterbation
        var fork_perterbation = this.perterbation / 2

        var penultimate = road.length - 2
        var ultimate = road.length - 1

        var theta = Math.atan2(road[ultimate].y - road[penultimate].y, road[ultimate].x - road[penultimate].x)

        // ----- branch from the road in both directions
        var decrement = random.random() + 0.5//, 1.1)
        for (var i = -1; i <= 1; i += 2) {
            // perpendicular slope
            var perpendicular_theta = theta + (i * (Math.PI / 2))
            var fork_next = this.next_road_segment(road[ultimate], decrement * segment_length, perpendicular_theta, fork_perterbation)
            if (fork_next.match) {
                var fork = [road[ultimate], fork_next.match]
                // track the new segment in the cmqtt data strucutre for efficient lookup later
                var cmqtt_segment = new Segment(road[ultimate], fork_next.match)
                this.roads_cmqtt.insert(cmqtt_segment)
                // a branch has been added
                this.roads.push(fork)
                if (!fork_next.end) {
                    this.continue_road(fork, segment_length * decrement, count + 1)
                }
            }
        }

        // ----- continue the road
        var next = this.next_road_segment(road[ultimate], segment_length, theta, road_perterbation)

        // terminate roads that are in water or off the map
        if (!next.match) {
            return
        }
        var cmqtt_segment = new Segment(road[ultimate], next.match)
        this.roads_cmqtt.insert(cmqtt_segment)
        road.push(next.match)
        if (!next.end) {
            this.continue_road(road, segment_length, count + 1)
        }
        return road
    }

    next_road_segment(point, distance, theta, perterbation) {
        // find a suitable continuation point

        var options = []
        for (var a = theta - perterbation; a <= theta + perterbation; a += Math.PI / 24) {
            var x = point.x + (distance * Math.cos(a))
            var y = point.y + (distance * Math.sin(a))
            // try to make bridges
            var create_bridge = random.random() > 1 - (this.get_population_density(point.x, point.y) * 0.1)
            if (this.on_map(x, y) && this.get_river(x, y) && create_bridge) {
                // maybe make a bridge
                var bridge_length = distance
                while (this.get_river(x, y)) {
                    x = point.x + (bridge_length * Math.cos(a))
                    y = point.y + (bridge_length * Math.sin(a))
                    bridge_length++
                }
                bridge_length += 7
                x = Math.round(point.x + (bridge_length * Math.cos(a)))
                y = Math.round(point.y + (bridge_length * Math.sin(a)))
                if (bridge_length < this.max_segment_length && this.validate_bridge_point([point, {x, y}])) {
                    options.push({x, y})
                }
            } else if (this.validate_road_point([point, {x, y}])) {
                options.push({x, y})
            }
        }
        if (options.length < 1) {
            return {'match': false, 'end': true}
        }

        var fit_function = function(p1, p2) {
            // needs to return smaller values for more desirable results, and we want least elevation change
            return 1 + Math.abs(this.get_elevation(p1.x, p1.y) - this.get_elevation(p2.x, p2.y))
        }
        var match = this.get_best_fit(point, options, fit_function)

        // check all the roads for options within the radius
        for (var r = this.roads.length - 1; r >= 0; r--) {
            var closest = this.get_best_fit(match.match, this.roads[r], get_distance)
            if (closest.distance < this.snap_radius) {
                return {'match': closest.match, 'end': true}
            }
        }

        return {
            'match': match.match,
            'end': false,
        }
    }

    validate_bridge_point(segment) {
        var x = segment[1].x
        var y = segment[1].y
        if (!this.on_map(x, y)) {
            return false
        }

        var cmqtt_segment = new Segment(segment[0], segment[1])
        return this.roads_cmqtt.query(cmqtt_segment, 0).length == 0
    }

    validate_road_point(segment) {
        var x = segment[1].x
        var y = segment[1].y
        if (this.is_water(x, y, 3) || !this.on_map(x, y)) {
            return false
        }

        var cmqtt_segment = new Segment(segment[0], segment[1])
        return this.roads_cmqtt.query(cmqtt_segment, 0).length == 0
    }

    get_best_fit(point, options, fit_function) {
        // compare a point to a set of other points to find the best fit
        var closest
        for (var i = 0; i < options.length; i++) {
            var option = options[i]
            if (!option) {
                // handles arrays with deleted entries set to undefined
                continue
            }
            var distance = fit_function.call(this, option, point)
            if (distance != 0 && (!closest || distance < closest[1])) {
                closest = [option, distance, i]
            }
        }
        if (!closest) {
            return false
        }
        return {
            'match': closest[0],
            'distance': closest[1],
            'index': closest[2]
        }
    }

    add_population_density() {
        // simplex noise that is centered around a downtown peak
        var start_time = new Date()
        var river_center = this.has_river ? this.riverline[Math.round(this.riverline.length / 2)] : {x: this.width - (this.width / 3), y: this.height - (this.height / 3)}
        var x = river_center.x
        var y = river_center.y
        while (this.is_water(x, y)) {
            y += 1
        }
        y += 20 // remove the city center enough from the river that it's out of the waterline radius
        this.city_center = {x, y}

        var longest = Math.sqrt(this.width ** 2 + this.height ** 2)
        for (var y = 0; y < this.height; y++) {
            for (var x = 0; x < this.width; x++) {
                if (this.is_water(x, y)) {
                    this.population_density[x][y] = -1
                    continue
                }
                // distance from city center - closer means higher density
                var distance = get_distance(this.city_center, {x, y})

                // higher number -> "zoom out"
                var frequency = this.elevation_scale / this.width

                var nx = x * frequency - 0.5
                var ny = y * frequency - 0.5

                // noisiness of edges
                var octaves = 1

                var noise_value = 0
                var divisor = 1
                for (var i = 1; i <= octaves; i = i * 2) {
                    noise_value += 1 / i * this.get_noise(i * nx, i * ny)
                    divisor += 1 / i
                }
                noise_value = noise_value / divisor // keeps the value between 0 and 1

                // set proportionality to city center
                // adding 0.00001 prevents the exact city center point from being infinite
                noise_value = noise_value * ((longest / (distance + 0.00001)) * 0.45)

                this.population_density[x][y] = noise_value
            }
        }
        var end_time = new Date()
        console.log('set population density', (end_time - start_time) / 1000)

        var start_time = new Date()
        this.population_peaks = []
        var radius = 1
        for (var y = 0; y < this.height; y++) {
            for (var x = 0; x < this.width; x++) {
                if (this.is_water(x, y)) {
                    continue
                }
                var angle = (2 * Math.PI / 10)
                var higher = true
                for (var a = 0; a < 2 * Math.PI; a += angle) {
                    var ix = x + radius * Math.cos(a)
                    var iy = y + radius * Math.sin(a)
                    if (this.get_population_density(x, y) < this.get_population_density(ix, iy) || this.is_water(ix, iy)) {
                        higher = false
                        break
                    }
                }
                if (higher) {
                    this.population_peaks.push([x, y, this.get_population_density(x, y)])
                }
            }
        }
        this.population_peaks.sort(function (a, b) { return a[2] > b[2] ? -1 : 1; })
        var end_time = new Date()
        console.log('find local maxima', (end_time - start_time) / 1000)
    }

    get_population_density(x, y) {
        x = Math.round(x)
        y = Math.round(y)
        if (this.on_map(x, y)) {
            return this.population_density[x][y]
        }
    }

    is_water(x, y, radius) {
        if (radius) {
            for (var a = 0; a < 2 * Math.PI; a += Math.PI / 6) {
                for (var r = 0; r < radius; r++) {
                    var nx = x + r * Math.cos(a)
                    var ny = y + r * Math.sin(a)
                    if (this.get_elevation(nx, ny) < 0) {
                        return true
                    }
                }
            }
        }
        return this.get_elevation(x, y) < 0
    }

    add_river() {
        // adds a river that runs from the NW corner
        var segment_length = 50
        var start = this.find_axis_low(0, 0, 1, this.height / 2)
        this.riverline = [start, {x: start.x + 1, y: start.y}]

        // use graded elevation
        this.real_elevation = this.get_elevation
        this.get_elevation = this.graded_elevation

        var success = false
        var i = 1
        var max_points = 200
        while (i < max_points) {
            // define a 2PI/3 degree arc "line of sight" from the previous point
            var vision_range = 2 * Math.PI / 3
            var start_angle = Math.PI + Math.atan2((this.riverline[i].y - this.riverline[i - 1].y), (this.riverline[i].x - this.riverline[i - 1].x)) + vision_range

            var lowest = [{}, this.height * this.width]
            // evaluate every point on the arc for the lowest elevation
            for (var a = start_angle; a < start_angle + vision_range; a += Math.PI / 20) {
                var sx = Math.round(this.riverline[i].x + (segment_length * Math.cos(a)))
                var sy = Math.round(this.riverline[i].y + (segment_length * Math.sin(a)))

                if (this.on_map(sx, sy) && this.get_elevation(sx, sy) < lowest[1]) {
                    // check for self-intersection
                    var intersecting = false
                    // these look 3x further ahead to check for intersection
                    var ix = Math.round(this.riverline[i].x + (3 * segment_length * Math.cos(a)))
                    var iy = Math.round(this.riverline[i].y + (3 * segment_length * Math.sin(a)))
                    for (var r = 0; r < this.riverline.length - 2; r++) {
                        if (this.segment_intersection(this.riverline[i], {x: ix, y: iy}, this.riverline[r], this.riverline[r + 1])) {
                            intersecting = true
                            break
                        }
                    }
                    if (!intersecting) {
                        lowest = [{x: sx, y: sy}, this.get_elevation(sx, sy)]
                    }
                }
            }
            // the river has failed, there will be no river
            if (!lowest[0].x || !lowest[0].y) {
                break
            }
            this.riverline.push(lowest[0])

            // stop if the river hits the ocean or the edge of the map
            if (this.get_elevation(lowest[0].x, lowest[0].y) < 0 ||
                    sx > this.width - (segment_length * 0.3) ||
                    sy > this.height - (segment_length * 0.3) ||
                    (sy < segment_length * 0.3 && i > 15)) {
                success = true
                // make sure the river hits the end of the map
                this.riverline.push({x: sx + segment_length, y: sy + segment_length})
                break
            }
            i++
        }
        this.get_elevation = this.real_elevation

        if (!success) {
            this.has_river = false
            return
        }

        var start_time = new Date()
        // place points between the current path
        var river_detail = []
        for (var r = 0; r < this.riverline.length - 1; r++) {
            var segment = [this.riverline[r], this.riverline[r + 1]]
            river_detail = river_detail.concat(this.displace_midpoint(segment,
                {offset_denominator: 5,
                 offset_balance: 0.5,
                 min_segment_length: 5}
            ))
        }
        this.riverline = river_detail

        // store min/max coords
        var max_x
        var min_y
        var max_y
        for (var i = 0; i < this.riverline.length; i++) {
            var point = this.riverline[i]
            if (max_x == undefined || point.x > max_x) {
                max_x = Math.round(point.x)
            }
            if (min_y == undefined || point.y < min_y) {
                min_y = Math.round(point.y)
            }
            if (max_y == undefined || point.y > max_y) {
                max_y = Math.round(point.y)
            }
        }
        var end_time = new Date()
        console.log('select river midpoints', (end_time - start_time) / 1000)

        var start_time = new Date()
        // dig out the riverbed
        var radius = 150
        min_y = radius - 150 < 0 ? 0 : radius - 150
        for (var y = min_y; y < (max_y + radius) && y < this.height; y++) {
            for (var x = 0; x < (max_x + radius) && x < this.width; x++) {
                // this starting distance is higher than the actual possible max
                var match = this.get_best_fit({x, y}, this.riverline, get_distance)
                this.elevation[x][y] -= 4 / ((match.distance + 0.00001) ** 1.5)
                if (this.get_elevation(x, y) < 0) {
                    this.river[x][y] = true
                }
            }
        }
        var end_time = new Date()
        console.log('dig out river', (end_time - start_time) / 1000)
    }

    graded_elevation(x, y) {
        // finds the elevation at a point with a gradiant applied so that the
        // NW corner is the highest
        return this.elevation[x][y] + ((this.height - y) + (4 * (this.width - x))) / (this.height + this.width)
    }

    add_ocean() {
        // adds an ocean to the SE corner of the map
        var start_time = new Date()
        var start = this.find_axis_low(this.width / 16, this.height - 1, 0, 5 * this.width / 8)
        var end = this.find_axis_low(this.width - 1, this.height / 16, 1, this.height / 2)

        // follow the terrain using displaced midline algorithm
        this.coastline = this.displace_midpoint([start, end], {
            offset_denominator: 5, offset_balance: 0.2, min_segment_length: 10})

        // add the map's SE corner to complete the polygon
        this.coastline.push({x: this.width-1, y: this.height-1})
        this.coastline.splice(0, 0, {x: this.width-1, y: this.height-1})

        // knowing the smallest coord means an easier elevation computation below
        var min_x
        var min_y
        for (var i = 0; i < this.coastline.length; i++) {
            var point = this.coastline[i]
            if (min_x == undefined || point.x < min_x) {
                min_x = Math.round(point.x)
            }
            if (min_y == undefined || point.y < min_y) {
                min_y = Math.round(point.y)
            }
        }
        var end_time = new Date()
        console.log('set coastline', (end_time - start_time) / 1000)

        var start_time = new Date()
        // ray casting to determine which points are inside the coastline polygon
        for (var y = min_y; y < this.height; y++) {
            for (var x = min_x; x < this.width; x++) {
                // this starting distance is always higher than the actual possible max
                var distance = Math.pow(this.height, 2) + Math.pow(this.width, 2)
                var hits = []
                // compare this point to all the edges in the coastline polygon
                for (var j = 0; j < this.coastline.length - 1; j++) {
                    // check if the ray from x, y to the border intersects the line defined by this.coastline[j] -> this.coastline[j + 1]
                    var result = this.segment_intersection(
                        {x, y}, {x: this.width, y: y},
                        this.coastline[j], this.coastline[j + 1])

                    // while we're here, calculate the distance between this
                    // point and this spot on the coast, so we can change the
                    // elevation if necessary (closest line segment may not be
                    // the segment that the ray intersects)

                    // don't do this calculation with the final (corner) point
                    // because that's supposed to just be "out to sea"
                    if (j < this.coastline.length - 2) {
                        var h_distance = get_distance(this.coastline[j + 1], {x, y})
                        distance = h_distance < distance ? h_distance : distance
                    }

                    if (result) {
                        hits.push({x: this.coastline[j], y: this.coastline[j + 1]})
                    }
                }
                // if there are an odd number of hits, then it's inside the ocean polygon
                if (hits.length % 2 == 1) {
                    // set the depth of this field relative to the distance
                    // from the coastline
                    this.elevation[x][y] -= (distance ** 2) / 10000
                    this.ocean[x][y] = true
                }
            }
        }
        var end_time = new Date()
        console.log('dig out ocean', (end_time - start_time) / 1000)
    }

    segment_intersection(p1, p2, p3, p4) {
        // check if two line segments intersect
        var threshold = 1
        if (get_distance(p2, p3) < threshold) {
            return false
        }

        var ccw = this.counterclockwise
        return ccw(p1, p3, p4) != ccw(p2, p3, p4) && ccw(p1, p2, p3) != ccw(p1, p2, p4)
    }

    counterclockwise(a, b, c) {
        // utility function for determining if line segments intersect
        return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x)
    }

    find_axis_low(x, y, axis, range) {
        // utility function for picking lowpoints on the edges of the map
        var low = [{x, y}, 1] // the lowest elevation point found in range
        var cp = {x, y} // stores the current point being investigated

        for (var i = 0; i < range; i++) {
            cp[axis] += 1
            if (!this.on_map(cp.x, cp.y)) {
                break
            }
            var current_elevation = this.get_elevation(cp.x, cp.y)
            if (current_elevation < low.y) {
                low = [cp, current_elevation]
            }
        }
        return low[0]
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
            params.index_1 = 0
            params.index_2 = 1
        }
        var start = curve[params.index_1]
        var end = curve[params.index_2]
        var segment_length = get_distance(start, end)
        if (segment_length < params.min_segment_length) {
            return curve
        }
        var midpoint = {x: Math.round((start.x + end.x) / 2),
                        y: Math.round((start.y + end.y) / 2)}

        // equation of the perpendicular line is y = mx + b
        var m = -1 * (start.x - end.x) / (start.y - end.y)
        var b = midpoint.y - (m * midpoint.x)
        var x = midpoint.x
        var y

        var optimal = [midpoint, this.get_elevation(midpoint.x, midpoint.y)]
        var offset = Math.round(segment_length / params.offset_denominator)
        var perpendicular_start = offset * (0 - params.offset_balance)
        var perpendicular_end = offset * (1 - params.offset_balance)

        // check for the lowest elevation along the perpendicular path
        for (var i = perpendicular_start; i < perpendicular_end; i++) {
            var nx = Math.round(x + (i / Math.abs(i)) * Math.sqrt(i ** 2 / (1 + m ** 2)))
            y = Math.round((m * nx) + b)
            if (!this.on_map(nx, y)) {
                continue
            }
            var elevation = this.get_elevation(nx, y)
            if (elevation < optimal[1]) {
                optimal = [{x: nx, y: y}, elevation]
            }
        }
        var displaced = optimal[0]

        curve.splice(params.index_2, 0, displaced)

        // continue recursively with modified copies of the original params
        var right_params = Object.assign({}, params)
        right_params.index_1 = params.index_2
        right_params.index_2 = params.index_2 + 1
        curve = this.displace_midpoint(curve, right_params)

        return this.displace_midpoint(curve, params)
    }

    on_map(x, y) {
        // is the point on the map?
        return x >= 0 && y >= 0 && x < this.width && y < this.height
    }

    on_edge(x, y) {
        return x == 0 || y == 0 || x >= this.width - 1 || y >= this.height - 1
    }

    create_matrix() {
        // produces a map-sized matrix
        var matrix = []
        for (var x = 0; x < this.width; x++) {
            matrix[x] = new Array(this.height)
        }
        return matrix
    }
}

module.exports = Map
