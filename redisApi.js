const redis = require('redis');

// create a new redis client and connect to our local redis instance
const client = redis.createClient();

// if an error occurs, print it to the console
client.on('error', function (err) {
    console.log('Error connecting redis: ' + err);
});

module.exports = {

	getKey: function(key, failureCallback, successCallback) {
		client.get(key, function(err, reply) {
			if (err) {
				failureCallback(err);
			} else {
				successCallback(reply);
			}
		});
	},

	setKey: function(key, value, failureCallback, successCallback) {
		client.set(key, value, function(err, reply) {
			if (err) {
				failureCallback(err);
			} else {
				successCallback(reply);
			}
		});
	},

	setKeyWithExpire: function(key, value, expireTime, failureCallback, successCallback) {
		client.set(key, value, 'EX', expireTime, function(err, reply) {
			if (err) {
				failureCallback(err);
			} else {
				successCallback(reply);
			}
		});
	},

	deleteKey: function(key, failureCallback, successCallback) {
		client.del(key, function(err, reply) {
			if (err) {
				failureCallback(err);
			} else {
				successCallback(reply);
			}
		});
	}
};