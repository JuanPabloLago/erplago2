module.exports = {
  apps: [{
    name: 'erplago',
    script: './server.js',
    cwd: '/root/mi_erp',
    env_file: '.env',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G'
  }]
};
