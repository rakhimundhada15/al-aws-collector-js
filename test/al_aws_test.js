const assert = require('assert');
const m_alAws = require('../al_aws');
const colMock = require('./collector_mock');
var AWS = require('aws-sdk-mock');


describe('al_aws Tests', function() {
    describe('arnToName() tests', function() {
        it('Valid input', function(done) {
            assert.equal(m_alAws.arnToName('arn:aws:iam::123456789101:role/testRole'), 'testRole');
            assert.equal(m_alAws.arnToName('arn:aws:kinesis:us-east-1:123456789101:stream/test-KinesisStream'), 'test-KinesisStream');
            assert.equal(m_alAws.arnToName('arn:aws:sqs:us-east-1:352283894008:testSqs'), 'testSqs');
            assert.equal(m_alAws.arnToName('arn:aws:s3:::teambucket'), 'teambucket');
            done();
        });
        
        it('Invalid input', function(done) {
            assert.ifError(m_alAws.arnToName(''));
            assert.ifError(m_alAws.arnToName('invalid'));
            assert.ifError(m_alAws.arnToName('arn:aws:invalid'));
            done();
        });
    });
    
    describe('arnToAccId() tests', function() {
        it('Valid input', function(done) {
            assert.equal(m_alAws.arnToAccId('arn:aws:iam::123456789101:role/testRole'), '123456789101');
            assert.equal(m_alAws.arnToAccId('arn:aws:kinesis:us-east-1:123456789101:stream/test-KinesisStream'), '123456789101');
            assert.equal(m_alAws.arnToAccId('arn:aws:sqs:us-east-1:352283894008:testSqs'), '352283894008');
            assert.equal(m_alAws.arnToAccId('arn:aws:s3:::teambucket'), '');
            done();
        });
        
        it('Invalid input', function(done) {
            assert.ifError(m_alAws.arnToAccId(''));
            assert.ifError(m_alAws.arnToAccId('invalid'));
            assert.ifError(m_alAws.arnToAccId('arn:aws:invalid'));
            done();
        });
    });
    
    describe('getS3ConfigChanges() function', () => {
        var jsonCfg = "{\"key\":\"value\"}";
        var s3Object = {Body: new Buffer(jsonCfg)};
    
        beforeEach(() => {
            colMock.initProcessEnv();
        });
        afterEach(() => {
            AWS.restore('S3', 'getObject');
        });
    
        it('sunny case with predefined name', () => {
            AWS.mock('S3', 'getObject', function(params, callback) {
                assert.equal(params.Bucket, colMock.S3_CONFIGURATION_BUCKET);
                assert.equal(params.Key, colMock.S3_CONFIGURATION_FILE_NAME);
                return callback(null, s3Object);
            });
    
            m_alAws.getS3ConfigChanges((err, config) => {
                assert.equal(jsonCfg, JSON.stringify(config));
            });
        });
    
        it('error', () => {
            AWS.mock('S3', 'getObject', function (params, callback) {
                assert.equal(params.Bucket, colMock.S3_CONFIGURATION_BUCKET);
                assert.equal(params.Key, colMock.S3_CONFIGURATION_FILE_NAME);
                return callback("key not found error");
            });
    
            m_alAws.getS3ConfigChanges(function(err, config) {
                assert.equal("key not found error", err);
            });
        });
    });
    
    describe('getLambdaConfig() function', () => {
    
        beforeEach(() => {
            colMock.initProcessEnv();
        });
        
        afterEach(() => {
            AWS.restore('Lambda', 'getFunctionConfiguration');
        });
        
        it('check function name', () => {
            AWS.mock('Lambda', 'getFunctionConfiguration', (params, callback) => {
                assert.equal(colMock.FUNCTION_NAME, params.FunctionName);
                return callback(null, "ok");
            });
    
            m_alAws.getLambdaConfig((err, config) => {
                assert.equal("ok", config);
            });
        });
    });
    
    describe('setEnv() function', () => {
        
        beforeEach(() => {
            colMock.initProcessEnv();
        });
        
        afterEach(() => {
            AWS.restore('Lambda', 'getFunctionConfiguration');
            AWS.restore('Lambda', 'updateFunctionConfiguration');
        });
        
        it('check env update', (done) => {
            AWS.mock('Lambda', 'getFunctionConfiguration', (params, callback) => {
                assert.equal(colMock.FUNCTION_NAME, params.FunctionName);
                const config = {
                    LastUpdateStatus: 'Success',
                    Environment: {
                        Variables: {
                            test_var: 'test_var'
                        }
                    }
                };
                return callback(null, config);
            });
            AWS.mock('Lambda', 'updateFunctionConfiguration', (params, callback) => {
                assert.equal(colMock.FUNCTION_NAME, params.FunctionName);
                return callback(null, params);
            });
    
            const testVars = {
                ingest_api: 'ingest.api',
                azcollect_api: 'azcollect.api'
            };
            m_alAws.setEnv(testVars, (err, config) => {
                assert.equal('ingest.api', config.Environment.Variables.ingest_api);
                assert.equal('azcollect.api', config.Environment.Variables.azcollect_api);
                assert.equal('test_var', config.Environment.Variables.test_var);
                done();
            });
        });
        
        it('check env update with retries', (done) => {
            const configSuccess = {
                LastUpdateStatus: 'Success',
                Environment: {
                    Variables: {
                        test_var: 'test_var',
                        new_var: 'new_var'
                    }
                }
            };
            const configInProgress = {
                LastUpdateStatus: 'InProgress',
                Environment: {
                    Variables: {
                        test_var: 'test_var'
                    }
                }
            };
            let callCount = 0;
            AWS.mock('Lambda', 'getFunctionConfiguration', (params, callback) => {
                assert.equal(colMock.FUNCTION_NAME, params.FunctionName);
                if (callCount === 0) {
                    callCount++;
                    return callback(null, configInProgress);
                } else {
                    return callback(null, configSuccess);
                }
            });
            
            AWS.mock('Lambda', 'updateFunctionConfiguration', (params, callback) => {
                assert.equal(colMock.FUNCTION_NAME, params.FunctionName);
                return callback(null, params);
            });
    
            const testVars = {
                ingest_api: 'ingest.api',
                azcollect_api: 'azcollect.api'
            };
            m_alAws.setEnv(testVars, (err, config) => {
                assert.equal('ingest.api', config.Environment.Variables.ingest_api);
                assert.equal('azcollect.api', config.Environment.Variables.azcollect_api);
                assert.equal('test_var', config.Environment.Variables.test_var);
                assert.equal('new_var', config.Environment.Variables.new_var);
                done();
            });
        }).timeout(3000);
        
        it('check env update error with retries', (done) => {
            const configInProgress = {
                LastUpdateStatus: 'InProgress',
                Environment: {
                    Variables: {
                        test_var: 'test_var'
                    }
                }
            };
            AWS.mock('Lambda', 'getFunctionConfiguration', (params, callback) => {
                assert.equal(colMock.FUNCTION_NAME, params.FunctionName);
                return callback(null, configInProgress);
            });
            
            AWS.mock('Lambda', 'updateFunctionConfiguration', (params, callback) => {
                assert.equal(colMock.FUNCTION_NAME, params.FunctionName);
                return callback(null, params);
            });
    
            const testVars = {
                ingest_api: 'ingest.api',
                azcollect_api: 'azcollect.api'
            };
            m_alAws.setEnv(testVars, (err, config) => {
                assert.equal(409, err.code);
                assert.equal('Function update is in progress', err.message);
                done();
            });
        }).timeout(120000);
    });

    describe('uploadS3Object() function', () => {

        var s3PutObjectResponse = {
            ETag: '3a78d463e605c66b1b51725500b9dd72',
            LastModified: '2017-11-21T16:40:00Z'
        };

        let bucketParameters = {
            data: colMock.S3_TEST_DATA,
            key: colMock.S3_CONFIGURATION_FILE_NAME
        };

        beforeEach(() => {
            colMock.initProcessEnv();
        });
        afterEach(() => {
            AWS.restore('S3', 'putObject');
        });

        it('if bucket name is undefined/null return error', () => {
            process.env.aws_lambda_s3_bucket = undefined;

            m_alAws.uploadS3Object(bucketParameters, (err, response) => {
                assert.notEqual(err, null);
            });
        });

        it('uploaded file successfully ', () => {
            AWS.mock('S3', 'putObject', function (params, callback) {
                assert.equal(params.Bucket, colMock.S3_CONFIGURATION_BUCKET);
                assert.equal(params.Key, colMock.S3_CONFIGURATION_FILE_NAME);
                return callback(null, s3PutObjectResponse);
            });

            bucketParameters.bucket = colMock.S3_CONFIGURATION_BUCKET;
            m_alAws.uploadS3Object(bucketParameters, (err, response) => {
                assert.equal(s3PutObjectResponse, response);
            });
        });
    });
});


