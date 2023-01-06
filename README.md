# server-control

* create AMI with supervisor, git and node
* create user node with home in /var/node
* add an ssh pull only key to the node user in /var/node/.ssh/id_rsa
* clone your project

sample config to add to your app:

```javascript

sc.init(app, {
	prefix: '/',
    repo_url: 'git@github.com:user/project.git',
    repo_dir: '/var/node/project',
    service_port: port,
    secret: "update-secret"
});

```

* npm install jim-lake/server-control --save
* cp node_modules/server-control/git_update_to_hash.sh /var/node/project/git_update_to_hash.sh
* chmod +x git_update_to_hash.sh
* cp node_modules/server-control/api_update.sh /var/lib/cloud/scripts/per-instance/api_update.sh
* chmod +x /var/lib/cloud/scripts/per-instance/api_update.sh 

* create an Autoscale group with that AMI.
* pass the project dir and git HASH in your user datain the user-data:
```bash
PROJECT_DIR=/var/node/project
API_GIT_HASH=6c3xxx12348e2e97560e0081d3bf44bdbfb8ifn3
```
* assign an IAM role with the following configuration:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Stmt1412101976000",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances"
      ],
      "Resource": [
        "*"
      ]
    },
    {
      "Sid": "Stmt1412102095000",
      "Effect": "Allow",
      "Action": [
        "autoscaling:CreateLaunchConfiguration",
        "autoscaling:DescribeAutoScalingGroups",
        "autoscaling:DescribeLaunchConfigurations",
        "autoscaling:UpdateAutoScalingGroup"
      ],
      "Resource": [
        "*"
      ]
    }
  ]
}
```

* If your config has a role, you'll also need to add passrole

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": "iam:PassRole",
            "Resource": "arn:aws:iam::<account>:role/<role>"
        }
    ]
}
```

* launch!
