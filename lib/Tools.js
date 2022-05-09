const fs = require("fs");
const path = require("path");
const Jimp = require("jimp");
const { crop } = require("jimp");

const chargerImagePath = path.join(__dirname, '../assets/img/charger.png');
const robotImagePath = path.join(__dirname, '../assets/img/robot.png');

// Overload Jimp crop in order to extract cropping result from autocrop
Jimp.prototype.__crop = Jimp.prototype.crop
Jimp.prototype.crop = function (x, y, w, h, cb) {  
this.cropArea = { x, y, w, h }
    return this.__crop(x, y, w, h, cb)
}

const Tools = {
    DIMENSION_PIXELS: 1024,
    DIMENSION_MM: 50 * 1024,

    MK_DIR_PATH: function (filepath) {
        var dirname = path.dirname(filepath);
        if (!fs.existsSync(dirname)) {
            Tools.MK_DIR_PATH(dirname);
        }
        if (!fs.existsSync(filepath)) {
            fs.mkdirSync(filepath);
        }
    },

    /**
     *
     * @param options {object}
     * @param options.parsedMapData
     * @param options.settings
     * @param callback {function}
     * @constructor
     */
    DRAW_MAP_PNG: function (options, callback) {
        const settings = Object.assign({
            drawPath: true,
            drawCharger: true,
            drawRobot: true,
            scale: 4,
            gradientBackground: true,
            crop_x1: 0,
            crop_x2: Number.MAX_VALUE,
            crop_y1: 0,
            crop_y2: Number.MAX_VALUE
        }, options.settings);

        const colors = {
            background: Jimp.cssColorToHex('#33a1f5'),
            background2: Jimp.cssColorToHex('#046cd4'),
            floor: Jimp.cssColorToHex('#56affc'),
            obstacle_strong: Jimp.cssColorToHex('#a1dbff'),
            path: Jimp.rgbaToInt(255, 255, 255, 255),
            forbidden_marker: Jimp.rgbaToInt(255, 0, 0, 255),
            forbidden_zone: Jimp.rgbaToInt(255, 0, 0, 96),
            cleaned_marker: Jimp.rgbaToInt(53,125,46,255),
            cleaned_zone: Jimp.rgbaToInt(107,244,66,76),
            cleaned_block: Jimp.rgbaToInt(107,244,36,87)
        };

        const COLORS = !options.settings.colors ? colors : Object.assign(colors, (Object.keys(options.settings.colors).map(key => {
            options.settings.colors[key] = Jimp.cssColorToHex(options.settings.colors[key]);
        }),options.settings.colors));

        const pointInsideQuadrilateral = function(p,p1,p2,p3,p4) {
            let intersects = 0,
               a = [p4,p1,p2,p3],
               b = [p1,p2,p3,p4];
            for (let i = 0; i < 4; ++i) {
               intersects += intersectsRight(p[0], p[1], a[i][0], a[i][1], b[i][0], b[i][1]);
            }
            return intersects % 2 !== 0;
        };

        const intersectsRight = function(px, py, x1, y1, x2, y2) {
            let tmp;
            if (y1 === y2) return 0;
            if (y1 > y2) {
                tmp = x1; x1 = x2; x2 = tmp;
                tmp = y1; y1 = y2; y2 = tmp;
            }
            if (py < y1 || py >= y2) return 0;
            if (x1 === x2) return px <= x1 ? 1 : 0;
            return px <= x1 + (py - y1) * (x2 - x1) / (y2 - y1) ? 1 : 0;
        };

        const calcOverlayColor = function(background, overlay) {
            return {
                r: Math.min(Math.max(0,Math.round(overlay.a*overlay.r/255 + (1 - overlay.a/255)*background.r)),255),
                g: Math.min(Math.max(0,Math.round(overlay.a*overlay.g/255 + (1 - overlay.a/255)*background.g)),255),
                b: Math.min(Math.max(0,Math.round(overlay.a*overlay.b/255 + (1 - overlay.a/255)*background.b)),255)
            };
        };

        const drawLineByPoints = function(image,points,color) {
            let first = true;
            let oldPathX, oldPathY; // old Coordinates
            let dx, dy; //delta x and y
            let step, x, y, i;
            points.forEach(function (coord) {
                if (!first && settings.drawPath) {
                    dx = (coord[0] - oldPathX);
                    dy = (coord[1] - oldPathY);
                    if (Math.abs(dx) >= Math.abs(dy)) {
                        step = Math.abs(dx);
                    } else {
                        step = Math.abs(dy);
                    }
                    dx = dx / step;
                    dy = dy / step;
                    x = oldPathX;
                    y = oldPathY;
                    i = 1;
                    while (i <= step) {
                        image.setPixelColor(color, x, y);
                        x = x + dx;
                        y = y + dy;
                        i = i + 1;
                    }
                }
                oldPathX = coord[0];
                oldPathY = coord[1];
                first = false;
            });
        };

        const formatPointCoords = function(point,scale = 1) {
            return [
                Math.floor(point[0]/50 - options.parsedMapData.image.position.left) * scale,
                Math.floor(point[1]/50 - options.parsedMapData.image.position.top) * scale
            ];
        }

        new Jimp(options.parsedMapData.image.dimensions.width, options.parsedMapData.image.dimensions.height, COLORS['background'], function (err, image) {
            if (!err) {
                // Step 1: Draw Map
                ["floor", "obstacle_strong"].forEach(key => {
                    const color = COLORS[key];
                    options.parsedMapData.image.pixels[key].forEach(function drawPixel(px) {
                        image.setPixelColor(color, px[0], px[1]);
                    });
                });
                // Step 1.1: Draw Currently Cleaned Markers
                if (settings.drawCurrentlyCleanedZones && options.parsedMapData.currently_cleaned_zones) {
                    let currentlyCleanedZones = options.parsedMapData.currently_cleaned_zones.map(zone => {
                        return [[zone[0],zone[1]],[zone[2],zone[3]]].map(point => formatPointCoords(point));
                    });
                    currentlyCleanedZones.forEach(zone => {
                        let resultColor, overlayColor = Jimp.intToRGBA(COLORS['cleaned_zone']);
                        image.scan(Math.min(zone[0][0],zone[1][0]), Math.min(zone[0][1],zone[1][1]), Math.max(zone[0][0],zone[1][0]) - Math.min(zone[0][0],zone[1][0]), Math.max(zone[0][1],zone[1][1]) - Math.min(zone[0][1],zone[1][1]), function(x, y, idx) {
                            resultColor = calcOverlayColor({r: this.bitmap.data[idx], g: this.bitmap.data[idx+1], b: this.bitmap.data[idx+2], a: 255},overlayColor);
                            this.bitmap.data[idx + 0] = resultColor.r;
                            this.bitmap.data[idx + 1] = resultColor.g;
                            this.bitmap.data[idx + 2] = resultColor.b;
                        });
                    });
                    currentlyCleanedZones.forEach(zone => {
                        drawLineByPoints(image,[zone[0],[zone[0][0],zone[1][1]],zone[1],[zone[1][0],zone[0][1]],zone[0]],COLORS['cleaned_marker']);
                    });
                }
                if (settings.drawCurrentlyCleanedBlocks && options.parsedMapData.currently_cleaned_blocks) {
                    let resultColor, overlayColor = Jimp.intToRGBA(COLORS['cleaned_block']);
                    options.parsedMapData.currently_cleaned_blocks.forEach(segnum => {
                        if (options.parsedMapData.image.pixels.segments[segnum])
                        options.parsedMapData.image.pixels.segments[segnum].forEach(px => {
                            resultColor = calcOverlayColor(Jimp.intToRGBA(image.getPixelColor(px[0],px[1])),overlayColor);
                            image.setPixelColor(Jimp.rgbaToInt(resultColor.r,resultColor.g,resultColor.b,255),px[0],px[1]);
                        });
                    });
                }
                // Step 1.2: Draw Forbidden Markers
                if (settings.drawForbiddenZones && options.parsedMapData.forbidden_zones) {
                    let forbiddenZones = options.parsedMapData.forbidden_zones.map(zone => {
                        return [[zone[0],zone[1]],[zone[2],zone[3]],[zone[4],zone[5]],[zone[6],zone[7]]].map(point => formatPointCoords(point));
                    });
                    forbiddenZones.forEach(zone => {
                        let resultColor,
                            overlayColor = Jimp.intToRGBA(COLORS['forbidden_zone'])
                            minx = Math.min(zone[0][0],zone[3][0]),
                            miny = Math.max(zone[0][1],zone[1][1]),
                            maxx = Math.max(zone[1][0],zone[2][0]),
                            maxy = Math.max(zone[2][1],zone[3][1]);
                        image.scan(minx, miny, maxx - minx, maxy - miny, function(x, y, idx) {
                            if (pointInsideQuadrilateral([x,y],zone[0],zone[1],zone[2],zone[3])) {
                                resultColor = calcOverlayColor({r: this.bitmap.data[idx], g: this.bitmap.data[idx+1], b: this.bitmap.data[idx+2], a: 255},overlayColor);
                                this.bitmap.data[idx + 0] = resultColor.r;
                                this.bitmap.data[idx + 1] = resultColor.g;
                                this.bitmap.data[idx + 2] = resultColor.b;
                            }
                        });
                    });
                    forbiddenZones.forEach(zone => {
                        drawLineByPoints(image,zone.concat([zone[0]]),COLORS['forbidden_marker']);
                    });
                }
                if (settings.drawVirtualWalls === true && options.parsedMapData.virtual_walls) {
                    let virtualWalls = options.parsedMapData.virtual_walls.map(wall => {
                        return [[wall[0],wall[1]],[wall[2],wall[3]]].map(point => formatPointCoords(point));
                    });
                    virtualWalls.forEach(wall => {
                        drawLineByPoints(image,wall,COLORS['forbidden_marker']);
                    });
                }
                //Step 2: Scale
                image.scale(settings.scale, Jimp.RESIZE_NEAREST_NEIGHBOR);
                // Save scaled but unrotated and uncropped image for calibration points
                const DIMENSIONS_SCALED = { 
                    width: image.bitmap.width,
                    height: image.bitmap.height
                };

                //Step 3: Draw Path
                if (options.parsedMapData.path) {
                    drawLineByPoints(image,options.parsedMapData.path.points.map(point => formatPointCoords(point,settings.scale)),COLORS.path);
                }
                //Step 4: Load charger and robot icons
                let chargerImage, robotImage;
                let loadChargerImage = Jimp.read(chargerImagePath).then(loaded => { chargerImage = loaded; });
                let loadRobotImage = Jimp.read(robotImagePath).then(loaded => { robotImage = loaded; });
                Promise.all([loadChargerImage, loadRobotImage]).then(() => {
                    //Step 5: Draw charger
                    if (settings.drawCharger === true && options.parsedMapData.charger) {
                        const chargerCoords = formatPointCoords(options.parsedMapData.charger,settings.scale);
                        chargerImage.scaleToFit(settings.scale * 12, settings.scale * 12, Jimp.RESIZE_BICUBIC);
                        image.composite(
                            chargerImage,
                            chargerCoords[0] - chargerImage.bitmap.width / 2,
                            chargerCoords[1] - chargerImage.bitmap.height / 2
                        );
                    }
                    //Step 6: Draw robot
                    if (settings.drawRobot === true && options.parsedMapData.robot) {
                        const robotCoords = formatPointCoords(options.parsedMapData.robot,settings.scale);
                        if (options.parsedMapData.robot_angle) {
                            robotImage.rotate(-1 * options.parsedMapData.robot_angle, false);
                        }
                        robotImage.scaleToFit(settings.scale * 12, settings.scale * 12, Jimp.RESIZE_BICUBIC);
                        image.composite(
                            robotImage,
                            robotCoords[0] - robotImage.bitmap.width / 2,
                            robotCoords[1] - robotImage.bitmap.height / 2
                        )
                    }

                    // Step 7: Rotate image if requested
                    if (parseInt(settings.rotate)) {
                        image.rotate(-parseInt(settings.rotate));
                    }
                    // Save for calibration point caluclation
                    const DIMENSIONS_ROTATED_UNCROPPED = {
                        width: image.bitmap.width,
                        height: image.bitmap.height
                    };

                    // Step 8a: Manual crop image
                    const BOUNDS = {
                        x1: Math.min(Math.max(0,settings.crop_x1*settings.scale), Math.max(0,image.bitmap.width-1)),
                        x2: Math.min(Math.max(0,settings.crop_x2*settings.scale), image.bitmap.width),
                        y1: Math.min(Math.max(0,settings.crop_y1*settings.scale), Math.max(0,image.bitmap.height-1)),
                        y2: Math.min(Math.max(0,settings.crop_y2*settings.scale), image.bitmap.height),
                    };
                    var MANUAL_CROP;
                    if ((BOUNDS.x1 > 0 || BOUNDS.x2 < image.bitmap.width || BOUNDS.y1 > 0 || BOUNDS.y2 < image.bitmap.height) && BOUNDS.x2 - BOUNDS.x1 > 0 && BOUNDS.y2 - BOUNDS.y1 > 0) {
                        image.crop(BOUNDS.x1, BOUNDS.y1, (BOUNDS.x2 - BOUNDS.x1), (BOUNDS.y2 - BOUNDS.y1));
                        MANUAL_CROP = {
                            x: BOUNDS.x1,
                            y: BOUNDS.y1
                        };
                    } else {
                        MANUAL_CROP = {
                            x: 0,
                            y: 0
                        };
                    }

                    // Step 8b: Auto crop image
                    var AUTO_CROP;
                    if (settings.autoCrop && image.bitmap.width > 0 && image.bitmap.height > 0) {
                        image.autocrop({ leaveBorder: parseInt(settings.autoCrop) || 20, cropOnlyFrames: false }, (error, image) => {    
                            image.cropArea // cropArea = { x, y, w, h }
                          });
                        AUTO_CROP = {
                            x: image.cropArea.x,
                            y: image.cropArea.y
                        };
                    } else {
                        AUTO_CROP = {
                            x: 0,
                            y: 0
                        };
                    }

                    // Step 9: Make gradient background
                    if (settings.gradientBackground) {
                        let pp, cc, py = -1,
                            c1 = Jimp.intToRGBA(COLORS['background']),
                            c2 = Jimp.intToRGBA(COLORS['background2']);
                        image.scan(0, 0, image.bitmap.width, image.bitmap.height, function(x, y, idx) {
                            if (py !== y) {
                                py = y;
                                pp = y / image.bitmap.height;
                                cc = {r: c2.r * pp + c1.r * (1 - pp), g: c2.g * pp + c1.g * (1 - pp), b: c2.b * pp + c1.b * (1 - pp)};
                            }
                            if (image.getPixelColor(x, y) === COLORS['background']) {
                                this.bitmap.data[idx + 0] = cc.r;
                                this.bitmap.data[idx + 1] = cc.g;
                                this.bitmap.data[idx + 2] = cc.b;
                            }
                        });
                    }

                    // Step 10: Calculate calibration points

                    // Step 10.1: Generate three calibration points in image coordinates
                    const CALIBRATION_POINT_BORDER = 20; // Distance to image outline
                    var CALIBRATION_POINTS_IMAGE;
                    if (image.bitmap.width > image.bitmap.height) {
                        CALIBRATION_POINTS_IMAGE = {
                            x1: CALIBRATION_POINT_BORDER,
                            y1: CALIBRATION_POINT_BORDER,
                            x2: Math.round(image.bitmap.width / 2),
                            y2: image.bitmap.height - CALIBRATION_POINT_BORDER,
                            x3: image.bitmap.width - CALIBRATION_POINT_BORDER,
                            y3: CALIBRATION_POINT_BORDER
                        };
                    } else {
                        CALIBRATION_POINTS_IMAGE = {
                            x1: CALIBRATION_POINT_BORDER,
                            y1: CALIBRATION_POINT_BORDER,
                            x2: image.bitmap.width - CALIBRATION_POINT_BORDER,
                            y2: Math.round(image.bitmap.height / 2),
                            x3: CALIBRATION_POINT_BORDER,
                            y3: image.bitmap.height - CALIBRATION_POINT_BORDER
                        };
                    }

                    // Step 10.2: Calculate combined crop from manual and auto
                    const COMBINED_CROP = {
                        x: MANUAL_CROP.x + AUTO_CROP.x,
                        y: MANUAL_CROP.y + AUTO_CROP.y
                    };

                    // Step 10.3: Calculate calibration points in unscaled, unrotated, and uncropped image

                    // Step 10.3.1: revert crop
                    const CALIBRATION_POINTS_IMAGE_UNCROPPED_SCALED_ROTATED = {
                        x1: CALIBRATION_POINTS_IMAGE.x1 + COMBINED_CROP.x,
                        y1: CALIBRATION_POINTS_IMAGE.y1 + COMBINED_CROP.y,
                        x2: CALIBRATION_POINTS_IMAGE.x2 + COMBINED_CROP.x,
                        y2: CALIBRATION_POINTS_IMAGE.y2 + COMBINED_CROP.y,
                        x3: CALIBRATION_POINTS_IMAGE.x3 + COMBINED_CROP.x,
                        y3: CALIBRATION_POINTS_IMAGE.y3 + COMBINED_CROP.y,
                    };

                    // Step 10.3.2: revert rotation
                        // https://en.wikipedia.org/wiki/Rotation_matrix#Rotations_in_two_dimensions
                        // x_unrotated = (x - width_rotated / 2) * cos(alpha) - (y - height_rotated / 2) * sin(alpha) + width_unrotated / 2
                        // y_unrotated = (x - width_rotated / 2) * cos(alpha) + (y - height_rotated / 2) * sin(alpha) + height_unrotated / 2
                    const alpha = parseFloat(settings.rotate) * Math.PI / 180.0; // Math likes radiants
                    const CALIBRATION_POINTS_IMAGE_UNCROPPED_SCALED_UNROTATED = {
                        x1: (CALIBRATION_POINTS_IMAGE_UNCROPPED_SCALED_ROTATED.x1 - DIMENSIONS_ROTATED_UNCROPPED.width / 2) * Math.cos(alpha) - 
                                (CALIBRATION_POINTS_IMAGE_UNCROPPED_SCALED_ROTATED.y1 - DIMENSIONS_ROTATED_UNCROPPED.height / 2) * Math.sin(alpha) + DIMENSIONS_SCALED.width / 2,
                        y1: (CALIBRATION_POINTS_IMAGE_UNCROPPED_SCALED_ROTATED.x1 - DIMENSIONS_ROTATED_UNCROPPED.width / 2) * Math.sin(alpha) + 
                                (CALIBRATION_POINTS_IMAGE_UNCROPPED_SCALED_ROTATED.y1 - DIMENSIONS_ROTATED_UNCROPPED.height / 2) * Math.cos(alpha) + DIMENSIONS_SCALED.height / 2,
                        x2: (CALIBRATION_POINTS_IMAGE_UNCROPPED_SCALED_ROTATED.x2 - DIMENSIONS_ROTATED_UNCROPPED.width / 2) * Math.cos(alpha) - 
                                (CALIBRATION_POINTS_IMAGE_UNCROPPED_SCALED_ROTATED.y2 - DIMENSIONS_ROTATED_UNCROPPED.height / 2) * Math.sin(alpha) + DIMENSIONS_SCALED.width / 2,
                        y2: (CALIBRATION_POINTS_IMAGE_UNCROPPED_SCALED_ROTATED.x2 - DIMENSIONS_ROTATED_UNCROPPED.width / 2) * Math.sin(alpha) + 
                                (CALIBRATION_POINTS_IMAGE_UNCROPPED_SCALED_ROTATED.y2 - DIMENSIONS_ROTATED_UNCROPPED.height / 2) * Math.cos(alpha) + DIMENSIONS_SCALED.height / 2,
                        x3: (CALIBRATION_POINTS_IMAGE_UNCROPPED_SCALED_ROTATED.x3 - DIMENSIONS_ROTATED_UNCROPPED.width / 2) * Math.cos(alpha) - 
                                (CALIBRATION_POINTS_IMAGE_UNCROPPED_SCALED_ROTATED.y3 - DIMENSIONS_ROTATED_UNCROPPED.height / 2) * Math.sin(alpha) + DIMENSIONS_SCALED.width / 2,
                        y3: (CALIBRATION_POINTS_IMAGE_UNCROPPED_SCALED_ROTATED.x3 - DIMENSIONS_ROTATED_UNCROPPED.width / 2) * Math.sin(alpha) + 
                                (CALIBRATION_POINTS_IMAGE_UNCROPPED_SCALED_ROTATED.y3 - DIMENSIONS_ROTATED_UNCROPPED.height / 2) * Math.cos(alpha) + DIMENSIONS_SCALED.height / 2
                    };

                    // Step 10.3.3: revert scale
                    const CALIBRATION_POINTS_IMAGE_ORIGINAL = {
                        x1: CALIBRATION_POINTS_IMAGE_UNCROPPED_SCALED_UNROTATED.x1 / settings.scale,
                        y1: CALIBRATION_POINTS_IMAGE_UNCROPPED_SCALED_UNROTATED.y1 / settings.scale,
                        x2: CALIBRATION_POINTS_IMAGE_UNCROPPED_SCALED_UNROTATED.x2 / settings.scale,
                        y2: CALIBRATION_POINTS_IMAGE_UNCROPPED_SCALED_UNROTATED.y2 / settings.scale,
                        x3: CALIBRATION_POINTS_IMAGE_UNCROPPED_SCALED_UNROTATED.x3 / settings.scale,
                        y3: CALIBRATION_POINTS_IMAGE_UNCROPPED_SCALED_UNROTATED.y3 / settings.scale,
                    };
                    // We finally have the coordinates in the original image provided by the robot
                    
                    // Step 10.3.4:  Now we revert the process as in function 'formatPointCoords' does, but without scaling.
                    const CALIBRATION_POINTS_ROBOT = {
                        x1: (CALIBRATION_POINTS_IMAGE_ORIGINAL.x1 + options.parsedMapData.image.position.left) * 50,
                        y1: (CALIBRATION_POINTS_IMAGE_ORIGINAL.y1 + options.parsedMapData.image.position.top) * 50,
                        x2: (CALIBRATION_POINTS_IMAGE_ORIGINAL.x2 + options.parsedMapData.image.position.left) * 50,
                        y2: (CALIBRATION_POINTS_IMAGE_ORIGINAL.y2 + options.parsedMapData.image.position.top) * 50,
                        x3: (CALIBRATION_POINTS_IMAGE_ORIGINAL.x3 + options.parsedMapData.image.position.left) * 50,
                        y3: (CALIBRATION_POINTS_IMAGE_ORIGINAL.y3 + options.parsedMapData.image.position.top) * 50
                    };

                    // Step 10.4: Convert calibration points to json 
                    var results = [
                        {
                            vacuum: {
                                x: Math.round(CALIBRATION_POINTS_ROBOT.x1),
                                y: Math.round(CALIBRATION_POINTS_ROBOT.y1)
                            },
                            map: {
                                x: CALIBRATION_POINTS_IMAGE.x1,
                                y: CALIBRATION_POINTS_IMAGE.y1
                            }
                        },
                        {               
                            vacuum: {
                                x: Math.round(CALIBRATION_POINTS_ROBOT.x2),
                                y: Math.round(CALIBRATION_POINTS_ROBOT.y2)
                            },
                            map: {
                                x: CALIBRATION_POINTS_IMAGE.x2,
                                y: CALIBRATION_POINTS_IMAGE.y2
                            }
                        },
                        {
                            vacuum: {
                                x: Math.round(CALIBRATION_POINTS_ROBOT.x3),
                                y: Math.round(CALIBRATION_POINTS_ROBOT.y3)
                            },
                            map: {
                                x: CALIBRATION_POINTS_IMAGE.x3,
                                y: CALIBRATION_POINTS_IMAGE.y3
                            }
                        }
                    ];


                    //return results
                    var error;
                    var img;
                    image.getBuffer(Jimp.AUTO, (error, img) => {
                        if (error) reject(error);
                        else img;
                        callback(error, img, results);
                      });
                }).catch(err => callback(err));
            } else {
                callback(err);
            }
        });
    }
};

module.exports = Tools;
