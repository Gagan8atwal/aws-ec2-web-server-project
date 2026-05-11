whoami
uname -a
1s
ls
uname -a
free -h
df -h
who
ps aux
ss -tulnp
sudo -i
whoami
pwd
ls
cd/
ls
exit
whoami
pwd
ls
echo "my first file" > file1.txt
ls
cat file1.txt
ls -l file1.txt
chmod 600 file1.txt
ls -file1.txt
chmod 600 file1.txt
ls -l file1.txt
whoami
pwd
ls
cat file1.txt
chmod 600 file1.txt
ls -l file1.txt
whoami
ls
echo "practice continue" > test2.txt
cat test2.txt
chmod 644 test2.txt
ls -l test2.txt
ip a
whoami
hostname
ls ~/.ssh
 pwd
ls /
ls /var
uname -a
uptime
free -h
ls /var/log
hostname
ip a
uname a
free -h
uptime
uname -a
uptime
ip a
ls /var
ls /var/log
sudo ls /var/log | head
sudo tail -n 20 /var/log/messages
sudo tail -n 20 /var/log/syslog
journalctl -n 20
journalctl -p 3 -n 20
exit
aws --version
aws s3 ls
aws sts get-caller-identity
aws s3 ls
aws s3 ls://your-bucket-name
aws s3 ls
aws s3 ls s3://my-test-bucket-gagan
echo "hello from ec2" > test.txt
aws s3 cp test.txt s3://my-test-bucket-gagan
aws s3 ls s3://my-test-bucket-gagan
aws s3 cp s3://my-test-bucket-gagan/test.txt
aws s3 cp s3://my-test-bucket-gagan/test.txt download.txt
cat downloaded.txt
aws s3 ls
exit
aws s3 ls
aws sts get-caller-identity
aws s3 ls
aws s3 ls s3://my-test-bucket-gagan
aws sts get-caller-identity
aws s3 ls
 aws s3 ls s3://my-test-bucket-gagan
echo "hello aws" > test.txt
aws s3 cp test.txt s3://my-test-bucket-gagan/
mkdir backups
cd backups
echo "Backup created on $(date)" > backup.txt
aws s3 cp backup.txt s3://my-test-bucket-gagan/
nano backup.sh
ls
chmod +x backup.sh
chmod +x backup.shls
cat backup.sh
pwd
ls
cat backup.sh
pwd
cd backups
pwd
ls
find ~ -name "backup*"
cd backups
ls
cd ~
rm -f backup.shls backup.txt
cat > backup.sh << 'EOF'
#!/bin/bash
DATE=$(date +%F-%H-%M-%S)
echo "Backup created at $DATE" > backup-$DATE.txt
aws s3 cp backup-$DATE.txt s3://my-test-bucket-gagan/
EOF

chmod +x backup.sh
./backup.sh
aws s3 ls s3://my-test-bucket-gagan/
cd
cd ~
ls
cat backup.sh
chmod +x backup.sh
./backup.sh
aws s3 ls://my-test-bucket-gagan/
./backup.sh
aws s3 ls s3://my-test-bucket-gagan/
cat backup.sh
aws s3 ls s3://my-test-bucket-gagan/
./backup.sh
exit
</> bash
cd~
ls
</> bash
cat backup.sh
chmod +x backup.sh
./backup.sh
</> bash
aws s3 ls s3://my-test-bucket-gagan/
</> bash
crontab -e
whoami
uname -a
crontab -1
sudo yum install cronie -y
sudo service crond start
sudo chkconfig crond on
crontab -e
echo "*/1 * * * * /home/ec2-user/backup.sh >> /home/ec2-user/backup.log 2>&1" | crontab -
crontab -1
ls /home/ec2-user/backup.sh
chmod +x /home/ec2-user/backup.sh
/home/ec2-user/backup.sh
aws s3 ls s3://my-test-bucket-gagan/
crontab -r
printf "*/1 * * * * /home/ec2-user/backup.sh >> /home/ec2-user/backup.log 2>&1\n" | crontab -
crontab -l
/home/ec2-user/backup.sh
aws s3 ls s3://my-test-bucket-gagan/
*/1 * * * *
find /home/ec2-user -name "backup.sh"
chmod +x /home/ec2-user/backup.sh
/home/ec2-user/backup.sh
ls /home/ec2-user
chmod +x /home/ec2-user/backup.sh
/home/ec2-user/backup.sh
aws s3 ls s3://my-test-bucket-gagan/
whoami
cd~
cd ~
ls
cat > backup.sh << 'EOF'
#!/bin/bash

DATE=$(date +%F-%H-%M-%S)
FILE="backup-$DATE.txt"

echo "AWS practice backup created at $DATE" > $FILE

aws s3 cp $FILE s3://my-test-bucket-gagan/
EOF

chmod +x backup.sh
./backup.sh
aws s3 ls s3://my-test-bucket-gagan/
cd ~
ls backup.sh
chmod +x backup.sh
./backup.sh
aws s3 ls s3://my-test-bucket-gagan/
echo "*/1 * * * * /home/ec2-user/backup.sh >> /home/ec2-user/backup.log 2>&1" | crontab -
crontab -1
crontab -l
cat backup.log
aws s3 ls s3://my-test-bucket-gagan/
whoami
aws sts get-caller-idenity
aws sts get-caller-identity
aws s3 ls
cd `

cd ~
exit
aws sts get-caller-identity
aws s3 ls
cd ~
./backup.sh
mkdir aws-backup-project
cd aws-backup-project
nano backup.sh
chmod +x backup.sh
./backup.sh
nano README.md
chmod +x backupsh
chmod +x backup.sh
./backup.sh
aws sts get-caller-identity
aws s3 ls
aws s3 ls s3://random-bucket-name-123456
aws s3 ls s3://my-test-bucket-gagan/
crontab -l
cat backup.log
crontab -l
cd ~
./backup.sh
aws s3 ls s3://my-test-bucket-gagan/
ls -l backup.log
cat backup.log
aws s3 ls s3://my-test-bucket-gagan/
crontab -r
crontab -l
aws sts get-caller-identity
aws s3 ls s3://some-random-bucket-xyz-123
aws sts get-caller-identity
aws s3 ls s3://my-test-bucket-gagan/
aws s3 ls s3://random-bucket-xyz-999
aws s3 ls s3://my-test-bucket-gagan/
aws iam list-users
aws s3 ls s3://my-test-bucket-gagan/
aws iam list-users
aws s3 ls s3://my-test-bucket-gagan/
aws s3api get-bucket-acl --bucket my-test-bucket-gagan
curl http://169.254.169.254/latest/meta-data/
whoami
cat
cd ~/aws-backup-project
ls
git --version
sudo yum install git -y
git init
git add  .
git comit -m "intial AWs backup project"
git init
git add  .
git commit -m "intial AWS backup project"
git remote add origin https://github.com/Gagan8atwal/aws-backup-project.git
git branch -M main
git push -U origin main
cd ~/aws-backup-project
git remote -v
git status
git log --oneline
git remote -v
pwd
ls
whoami
pwd
ls -l
ps aux
ls /var/log
systemctl status crond
sudo tail /var/log/cron
sudo journalctl -u crond
echo "Hello, I built my first AWS EC2 web server 🚀" | sudo tee /var/www/html/index.html
http://<your-ec2-public-ip>
curl ifconfig.me
mkdir aws-ec2-web-project
cd aws-ec2-web-project
nano README.md
git add .
git commit -m "message"
git init
git add  .
git commit -m "AWS EC2 web server project with monitoring"
git remote add origin https://github.com/YOUR_USERNAME/aws-ec2-web-server-project.git
git branch -M main
git push -u origin main
sudo yum update -y
sudo yum instal httpd -y
sudo yum install httpd -y
sudo systemctl start httpd
sudo systemctl enable httpd
systemctl status httpd
