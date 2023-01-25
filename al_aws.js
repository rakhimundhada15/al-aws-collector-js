/* -----------------------------------------------------------------------------
 * @copyright (C) 2017, Alert Logic, Inc
 * @doc
 *
 * Helper class for lambda function utility and helper methods.
 *
 * Last message ID: AWSC0108
 * @end
 * -----------------------------------------------------------------------------
 */
'use strict';

const AWS = require('aws-sdk');
const moment = require('moment');
const async = require('async');
const logger = require('./logger');

const MIN_RANDOM_VALUE = 100;
const MAX_RANDOM_VALUE = 3000;
const AWS_STATISTICS_PERIOD_MINUTES = 15;
const MAX_ERROR_MSG_LEN = 1024;
const LAMBDA_CONFIG = {
        maxRetries: 10
};
const LAMBDA_UPDATE_RETRY = {
        times: 20,
        // intervals of 200, 400, 800, 1600, 3200, ... ms)
        interval: function(retryCount) {
            return Math.min(100 * Math.pow(2, retryCount), 5000);
        }
};

var selfUpdate = function (callback) {
    var params = {
      FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
      S3Bucket: process.env.aws_lambda_s3_bucket,
      S3Key: process.env.aws_lambda_zipfile_name
    };
    var lambda = new AWS.Lambda(LAMBDA_CONFIG);
    logger.info(`AWSC0100 Performing lambda self-update with params: ${JSON.stringify(params)}`);
    lambda.updateFunctionCode(params, function(err, data) {
        if (err) {
            logger.info(`AWSC0101 Lambda self-update error: ${JSON.stringify(err)}`);
        } else {
            logger.info('AWSC0102 Lambda self-update successful.  Data: ' + JSON.stringify(data));
        }
        return callback(err);
    });
};

var getS3ConfigChanges = function(callback) {
    var s3 = new AWS.S3();

    var params = {
        Bucket: process.env.aws_lambda_s3_bucket,
        Key: process.env.aws_lambda_update_config_name
    };
    s3.getObject(params, function(err, object) {
        if (err) {
            return callback(err);
        } else {
            try  {
                let config = JSON.parse(object.Body.toString());
                return callback(null, config);
            } catch(ex) {
                return callback('AWSC0103 Unable to parse config changes.')
            }
        }
    });
};

var getLambdaConfig = function(callback) {
    var lambda = new AWS.Lambda(LAMBDA_CONFIG);
    var params = {
        FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME
    };

    lambda.getFunctionConfiguration(params, callback);
};

var updateLambdaConfig = function(config, callback) {
    waitForFunctionUpdate(function(err) {
        if(err) {
            logger.error('AWSC0107 Error getting function config, lambda config was not updated', err);
            return callback(err);
        }
        var lambda = new AWS.Lambda(LAMBDA_CONFIG);
        return lambda.updateFunctionConfiguration(config, callback);
    });
};

//DEPRECATED FUNCTION
//please use statistics_templates.js instead
var getMetricStatistics = function (params, statistics, callback) {
    var cloudwatch = new AWS.CloudWatch({apiVersion: '2010-08-01'});
    cloudwatch.getMetricStatistics(params, function(err, data) {
        if (err) {
            statistics.push({
                Label: params.MetricName,
                StatisticsError: JSON.stringify(err).slice(0, MAX_ERROR_MSG_LEN)
            });
        } else {
            statistics.push({
                Label: data.Label,
                Datapoints: data.Datapoints
            });
        }
        return callback(null, statistics);
    });
};

//DEPRECATED FUNCTION
//please use statistics_templates.js instead
var getLambdaMetrics = function (functionName, metricName, statistics, callback) {
    var params = {
        Dimensions: [
              {
                  Name: 'FunctionName',
                  Value: functionName
              }
        ],
        MetricName: metricName,
        Namespace: 'AWS/Lambda',
        Statistics: ['Sum'],
        StartTime: moment().subtract(AWS_STATISTICS_PERIOD_MINUTES, 'minutes').toISOString(),
        EndTime: new Date(),
        Period: 60*AWS_STATISTICS_PERIOD_MINUTES   /* 15 mins as seconds */
    };
    return getMetricStatistics(params, statistics, callback);
};

//DEPRECATED FUNCTION
//please use statistics_templates.js instead
var getKinesisMetrics = function (streamName, metricName, statistics, callback) {
    var params = {
        Dimensions: [
              {
                  Name: 'StreamName',
                  Value: streamName
              }
        ],
        MetricName: metricName,
        Namespace: 'AWS/Kinesis',
        Statistics: ['Sum'],
        StartTime: moment().subtract(AWS_STATISTICS_PERIOD_MINUTES, 'minutes').toISOString(),
        EndTime: new Date(),
        Period: 60*AWS_STATISTICS_PERIOD_MINUTES   /* 15 mins as seconds */
    };
    return getMetricStatistics(params, statistics, callback);
};

var arnToName = function (arn) {
    const parsedArn = arn.split(':');
    if (parsedArn.length > 3) {
        const parsedId = parsedArn[parsedArn.length-1].split('/');
        return parsedId[parsedId.length-1];
    } else {
        return undefined;
    }
};

var arnToAccId = function (arn) {
    const parsedArn = arn.split(':');
    if (parsedArn.length > 4) {
        return parsedArn[4];
    } else {
        return undefined;
    }
};

var waitForFunctionUpdate = function (callback) {
    let lambda = new AWS.Lambda(LAMBDA_CONFIG);
    const getConfigParams = {
        FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME
    };
    async.retry(LAMBDA_UPDATE_RETRY, function(asyncCallback) {
        lambda.getFunctionConfiguration(getConfigParams, function(err, config) {
            if(err) {
                logger.warn('AWSC0105 Error getting function config', err);
                return asyncCallback(err);
            } else {
                if (config.LastUpdateStatus === 'InProgress') {
                    const inProgressError = {
                         message: 'Function update is in progress',
                         code: 409
                    };
                    return asyncCallback(inProgressError);
                } else {
                    return asyncCallback(null, config);
                }
            }
        });
    }, callback);
};

var setEnv = function(vars, callback) {
    waitForFunctionUpdate(function(err, config) {
        if(err) {
            logger.error('AWSC0104 Error getting function config, environment variables were not updated', err);
            return callback(err);
        }
        const lambda = new AWS.Lambda(LAMBDA_CONFIG);
        const getConfigParams = {
            FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME
        };
        const params = {
            FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
            Environment : {
                Variables : {
                    ...config.Environment.Variables,
                    ...vars
                }
            }
        };
        return lambda.updateFunctionConfiguration(params, callback);
    });
};

var uploadS3Object = function ({ data, key, bucket }, callback) {
    var s3 = new AWS.S3();
    // Setting up S3 putObject parameters
    const parseData = typeof data !== 'string' ? JSON.stringify(data) : data;
    if (bucket) {
        const params = {
            Bucket: bucket,
            Key: key,
            Body: parseData
        };
        // Uploading files to the bucket
        return s3.putObject(params, callback);
    } else {
        return callback(`AWSC0108 s3 bucketName can not be null or undefined`);
    }
};

function getRandomIntInclusive(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1) + min);
};


var customBackoff = function (retryCount, err) {
    if (err && err.code && err.code.indexOf('Throttling') > -1) {
        logger.debug(`AWSC00011 customBackoff:- retryCount:${retryCount} Error:${err} `);
        const randomValue = getRandomIntInclusive(MIN_RANDOM_VALUE, MAX_RANDOM_VALUE) + (Math.pow(2, retryCount) * 100);
        logger.debug(`AWSC00011 customBackoff:- delay: ${randomValue}`);
        return randomValue;
    } else {
        return 0;
    }
};



module.exports = {
    selfUpdate : selfUpdate,
    getS3ConfigChanges : getS3ConfigChanges,
    updateLambdaConfig : updateLambdaConfig,
    getLambdaConfig : getLambdaConfig,
    arnToName : arnToName,
    arnToAccId : arnToAccId,
    setEnv : setEnv,
    waitForFunctionUpdate: waitForFunctionUpdate,
    customBackoff: customBackoff,
    
    //DEPRECATED FUNCTIONS
    //please use statistics_templates.js instead
    getMetricStatistics : getMetricStatistics,
    getLambdaMetrics : getLambdaMetrics,
    getKinesisMetrics : getKinesisMetrics,
    uploadS3Object: uploadS3Object
};
