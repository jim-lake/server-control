'use strict';

var async = require('async');
var AWS = require('aws-sdk');
var _ = require('underscore');
var request = require('request');
var child_process = require('child_process');
var util = require('./utils.js');

exports.init = init;

var g_config = {};

get_aws_region(function(err, region)
{
    AWS.config.update({region: region});
});

var DEFAULT_CONFIG = {
    prefix: '/',
    secret: 'secret',
    git_hash_var_name: 'NODE_GIT_HASH',
    restart_function: default_restart_function,
    service_port: 3000,
    http_proto: 'http',
    auth_middleware: false,
    repo_dir: '.',
};

function default_restart_function()
{
    console.log("Successful update, restarting server");
    setTimeout(function()
    {
        process.exit(0);
    },100);
}

var REQUIRED_CONFIG_ITEMS = [
    'repo_url',
];

function init(app, config)
{
    var missing = _.difference(REQUIRED_CONFIG_ITEMS,_.keys(config));
    if( missing.length > 0 )
    {
        console.error("server-control: Add required elements to config.json:",missing);
        throw 'server-control config failed';
    }

    g_config = _.extend({},DEFAULT_CONFIG,config);

    get_git_commit_hash();

    addRoutes(app,g_config.prefix);
}

function addRoutes(app,prefix)
{
    app.get('/service_data',secret_or_auth,service_data);
    app.get('/update_service',secret_or_auth,update_service);

    app.get('/server_version',secret_or_auth,server_version);
    app.get('/update_server',secret_or_auth,update_server);
}

function secret_or_auth(req,res,next)
{
    if( req.body && req.body.secret && req.body.secret === g_config.secret )
    {
        next();
    }
    else if( false && g_config.auth_middleware )
    {
        g_config.auth_middleware(req,res,next);
    }
    else
    {
        res.status(403).end('Forbidden');
    }
}


function server_version(req,res)
{
    res.header("Cache-Control", "no-cache, no-store, must-revalidate");
    
    get_git_commit_hash(function(err,results)
    {
        if( err )
        {
            res.status(500).end('Internal Server Error');
        }
        else
        {
            res.send({ git_commit_hash: results } );
        }
    });
}

function service_data(req,res)
{
    res.header("Cache-Control", "no-cache, no-store, must-revalidate");
    
    get_service_data(function(err,result)
    {
        var ret = {
            master_git_hash: result.master_git_hash,
            instance_id: result.instance_id,
            instance_list: result.instance_list,
        };
        
        if( result.auto_scale_group )
        {
            ret.auto_scale_group = {
                name: result.auto_scale_group.AutoScalingGroupName,
                launch_configuration: {
                    name: result.auto_scale_group.LaunchConfigurationName,
                },
            };
        }
        if( result.launch_configuration )
        {
            ret.auto_scale_group.launch_configuration.image_id = result.launch_configuration.ImageId;
            if( result.launch_configuration.UserData )
            {
                var s = new Buffer(result.launch_configuration.UserData, 'base64').toString('ascii');
                ret.auto_scale_group.launch_configuration.user_data = s;
            }
        }
    
        if( err )
        {
            res.status(500).send({ err: err, ret: ret });
        }
        else
        {
            res.send(ret);
        }
    });
}

function get_service_data(all_done)
{
    var instance_id = false;
    var auto_scale_group = false;
    var instance_list = false;
    var launch_configuration = false;
    var master_git_hash = false;
    
    async.series([
    function(done)
    {
        var meta = new AWS.MetadataService();
        meta.request('/latest/meta-data/instance-id',function(err,results)
        {
            if( err )
            {
                error_log("server_data: Failed to get instance id:",err);
            }
            instance_id = results;
            done(err);
        });
    },
    function(done)
    {
        get_auto_scale_group(instance_id,function(err,asg)
        {
            if( !err )
            {
                if( !asg )
                {
                    error_log("server_data: ASG not found");
                    err = 'asg_not_found';
                }
                else
                {
                    auto_scale_group = asg;
                }
            }
            done(err);
        });
    },
    function(done)
    {
        var autoscaling = new AWS.AutoScaling();
        var params = {
            LaunchConfigurationNames: [ auto_scale_group.LaunchConfigurationName ],
        };
        autoscaling.describeLaunchConfigurations(params,function(err,data)
        {
            if( err )
            {
                error_log("server_data: launch config fetch error:",err);
            }
            else
            {
                if( data.LaunchConfigurations.length > 0 )
                {
                    launch_configuration = data.LaunchConfigurations[0];
                }
                else
                {
                    err = 'launch_config_not_found';
                }
            }
            done(err);
        });
    },
    function(done)
    {
        var ec2 = new AWS.EC2();
        var params = {
            InstanceIds: _.pluck(auto_scale_group.Instances,'InstanceId'),
        };
        ec2.describeInstances(params,function(err,results)
        {
            if( err )
            {
                error_log("server_data: describeInstances err:",err);
            }
            else
            {
                instance_list = [];
                _.each(results.Reservations,function(reservation)
                {
                    _.each(reservation.Instances,function(instance)
                    {
                        instance_list.push({
                            instance_id: instance.InstanceId,
                            image_id: instance.ImageId,
                            state: instance.State.Name,
                            instance_type: instance.InstanceType,
                            launch_datetime: instance.LaunchTime,
                            private_ip: instance.PrivateIpAddress,
                        });
                    });
                });
            }
            done(err);
        });
    },
    function(done)
    {
        var query_list = _.where(instance_list,{ state: "running" });
        async.each(query_list,function(instance,done2)
        {
            var url = "{0}://{1}:{2}{3}server_version".format(g_config.http_proto,instance.private_ip,g_config.service_port,g_config.prefix);
            var options = {
                strictSSL: false,
                url: url,
                method: 'GET',
                json: {
                    secret: g_config.secret,
                },
            };
            request(options,function(err,response,body)
            {
                if( err )
                {
                    error_log("server_data: request err:",err);
                }
                else if( response.statusCode != 200 )
                {
                    error_log("server_data: request fail code:",response.statusCode);
                    err = 'err_status_code';
                }
                else
                {
                    instance.git_commit_hash = body.git_commit_hash;
                }
                done2(err);
            });
        }, done);
    },
    function(done)
    {
        get_master_git_hash(function(err,hash)
        {
            master_git_hash = hash;
            done(err);
        });
    }],
    function(err)
    {
        var ret = {
            master_git_hash: master_git_hash,
            instance_id: instance_id,
            auto_scale_group: auto_scale_group,
            launch_configuration: launch_configuration,
            instance_list: instance_list,
        };
        all_done(err,ret);
    });
}

function update_server(req,res)
{
    res.header("Cache-Control", "no-cache, no-store, must-revalidate");
    
    var hash = required_prop(req,'hash');
    
    internal_update_server(hash,function(err)
    {
        if( err )
        {
            res.status(500).send(err);
        }
        else
        {
            g_config.restart_function();
            res.send("Restarting server");
        }
    });
}

function internal_update_server(hash,all_done)
{
    var revert_hash = false;
    
    async.series([
    function(done)
    {
        get_git_commit_hash(function(err,old_hash)
        {
            revert_hash = old_hash;
            done(err);
        });
    },
    function(done)
    {
        var cmd = "cd {0} && {1}/git_update_to_hash.sh {2} {3}".format(g_config.repo_dir,__dirname,hash,revert_hash);
        console.error("update cmd: ",cmd);
        child_process.exec(cmd,function(err,stdout,stderr)
        {
            if( err )
            {
                error_log("update_version: git_update_to_hash.sh failed with err:",err,"stdout:",stdout,"stderr:",stderr);
                err = "update_version: update failed";
            }
            done(err);
        });
    }],
    all_done);
}

function update_service(req,res)
{
    res.header("Cache-Control", "no-cache, no-store, must-revalidate");
    
    var hash = required_prop(req,'hash');
    
    var ami_id = req.param('ami_id',false);
    
    var autoscaling = new AWS.AutoScaling();
    var service_data = false;
    var launch_config_name = false;
    var current_user_data = false;
    
    async.series([
    function(done)
    {
        internal_update_server(hash,done);
    },
    function(done)
    {
        get_service_data(function(err,data)
        {
            service_data = data;
            done(err);
        });
    },
    function(done)
    {
        get_current_user_data(function(err, data)
        {
            if( !err )
            {
                // remove current hash key and empty lines
                current_user_data = "";
                _.each(data.split('\n'), function(line)
                {
                    if( line.length > 0 && line.indexOf(g_config.git_hash_var_name) == -1 )
                    {
                        current_user_data += line + '\n';
                    }
                });
            }
            done(err);
        });
    },
    function(done)
    {
        var match = service_data.launch_configuration.LaunchConfigurationName.match(/([^\d]*)(\d*)/);
        if( match.length < 3 )
        {
            launch_config_name = service_data.launch_configuration.LaunchConfigurationName + "-2";
        }
        else
        {
            var new_index = parseInt(match[2]) + 1;
            launch_config_name = match[1] + new_index;
        }
        
        var user_data = current_user_data;
        user_data += "{0}={1}\n".format(g_config.git_hash_var_name, hash);
        
        var props = [
            'ImageId',
            'SecurityGroups',
            'BlockDeviceMappings',
            'InstanceType',
            'InstanceMonitoring',
            'EbsOptimized',
            'AssociatePublicIpAddress',
            'PlacementTenancy',
        ];

        var params = _.pick(service_data.launch_configuration,props);
        params.InstanceId = service_data.instance_id;
        params.LaunchConfigurationName = launch_config_name;
        params.UserData = new Buffer(user_data).toString('base64');
        if( ami_id )
        {
            params.ImageId = ami_id;
        }
        autoscaling.createLaunchConfiguration(params,function(err,data)
        {
            if( err )
            {
                error_log("update_service: failed to createLaunchConfiguration:",err);
            }
            done(err);
        });
    },
    function(done)
    {
        var params = {
            AutoScalingGroupName: service_data.auto_scale_group.AutoScalingGroupName,
            LaunchConfigurationName: launch_config_name,
        };
        autoscaling.updateAutoScalingGroup(params,function(err,data)
        {
            if( err )
            {
                error_log("update_service: failed to updateAutoScalingGroup:",err);
            }
            done(err);
        });
    },
    function(done)
    {
        update_all_servers(hash,service_data,done);
    }],
    function(err,results)
    {
        if( err )
        {
            res.status(500).send(err);
        }
        else
        {
            var msg = "Successful updating all servers, restarting this server.";

            g_config.restart_function();

            var ret = {
                launch_config_name: launch_config_name,
                _msg: msg,
            };
            
            res.send(ret);
        }
    });
}

function update_all_servers(hash,service_data,all_done)
{
    async.each(service_data.instance_list,function(instance,done)
    {
        if( instance.instance_id == service_data.instance_id )
        {
            done();
        }
        else
        {
            var url = "{0}://{1}:{2}{3}update_server".format(g_config.http_proto,instance.private_ip,g_config.service_port,g_config.prefix);
            var options = {
                strictSSL: false,
                url: url,
                method: 'GET',
                json: {
                    hash: hash,
                    secret: g_config.secret,
                },
            };
            request(options,function(err,response,body)
            {
                if( err )
                {
                    error_log("update_service: request err:",err);
                }
                else if( response.statusCode != 200 )
                {
                    error_log("update_service: request fail code:",response.statusCode);
                    err = 'err_status_code';
                }
                done(err);
            });
        }
    },
    function(err,results)
    {
        all_done(err);
    });
}


function get_auto_scale_group(instance_id,done)
{
    var autoscaling = new AWS.AutoScaling();
    
    autoscaling.describeAutoScalingGroups({}, function(err, data)
    {
        if( err )
        {
            error_log("get_auto_scale_group: err:",err);
            done(err);
        }
        else
        {
            var found_asg = false;
            _.every(data.AutoScalingGroups,function(asg)
            {
                var found_instance = _.findWhere(asg.Instances,{ InstanceId: instance_id });
                if( found_instance )
                {
                    found_asg = asg;
                }
                return !found_asg;
            });
            done(null,found_asg);
        }
    });
}

function get_master_git_hash(done)
{
    var cmd = 'cd {0} && git ls-remote {1} refs/heads/master | cut -f 1'.format(g_config.repo_dir,g_config.repo_url);
    child_process.exec(cmd,function(err,stdout,stderr)
    {
        var ret = false;
        if( err )
        {
            error_log("get_master_git_hash: failed with err:",err);
        }
        else
        {
            ret = stdout.trim();
            if( ret.length != 40 )
            {
                err = 'bad_git_hash';
            }
        }
        done(err,ret);
    });
}

var g_git_commit_hash = false;

function get_git_commit_hash(done)
{
    if( !done )
    {
        done = function() {};
    }

    if( g_git_commit_hash )
    {
        done(null, g_git_commit_hash);
    } 
    else 
    {
        var cmd = 'cd {0} && git log -n 1 --pretty=format:"%H"'.format(g_config.repo_dir);
        child_process.exec(cmd, function(err,stdout,stderr)
        {
            if( err )
            {
                error_log("get_git_commit_hash: failed with err:",err,stdout,stderr);
            }
            else
            {
                g_git_commit_hash = stdout.trim();
            }
            done(null,g_git_commit_hash);
        });
    }
}

function error_log(msg)
{
    console.error(msg);
}

function required_prop(req,prop,is_sensitive)
{
    var v = req.param(prop);
    if( typeof v == 'undefined' )
    {
        throw { code: 400, body: prop + " is required" };
    }
    if( is_sensitive && prop in req.query )
    {
        throw { code: 400, body: prop + " not allowed in get params" };
    }
    return v;
}

function get_current_user_data(done)
{
    var m = new AWS.MetadataService();
    m.request('/latest/user-data',function(err,data)
    {
        if( err )
        {
            error_log("failed to get user data. Running locally?");
            data = "";
        } 
        done(err, data);
    }); 
}

function get_aws_region(done)
{
    var m = new AWS.MetadataService();
    m.request('/latest/dynamic/instance-identity/document',function(err,results)
    {
        var region = false;
        if( !err )
        {
            try
            {
                var json_data = JSON.parse(results);
                region = json_data['region'];
            }
            catch(e)
            {
                err = e;
            }
        }
        done(err,region)
    });
}


