const express = require('express'),
    app = express(),
    bodyParser = require('body-parser');

//node request module to make http requests
const request = require('request');

app.use(bodyParser.json());       // to support JSON-encoded bodies


app.listen(4000, function() {
	console.log("Listening on port: 4000");
});

const redisApi = require('./redisApi.js');

// hardcoded hotelier's mobile
const hoteliersMobileHardCoded = ['7206479844'];

const config = {
	redisExpireTime: 60 // 1 min
};

//http://voyager.goibibo.com/api/v1/hotels/get_hotels_data/?params={"id_list":["4404510055864933480"],"id_type":"_id"}

app.post('/whatsapp', function(req, res) {
	const params = req.body;
	params.message = params.callback_text; // to avoid breaking of code
	console.log('Received from whatsapp: ', params);
	
	const mobile = params.mobile;
	console.log(mobile, params.callback_text);
	if (params.location) {
		userMessageReceived(params);
	} else if (!isNaN(params.message)) { // received an integer i.i. choice
		userMessageReceived(params);
	} else {
		hotelierMessageReceived(params);
	}
	res.json({success: true});
});

function userMessageReceived(params) {
	const userMobile = params.mobile;
	const message = params.message;

	// check if it exists in redis db
	redisApi.getKey(userMobile, function failure(err) {
        console.log(err);
    }, function success(value) {
    	if (value && !params.location) {
    		// user selected a hotel, proceed with booking
    		const info = JSON.parse(value);

    		// check if user sent a valid option
    		try {
    			const selectedHotel = info.hotels[parseInt(message)];
    			console.log('Proceed booking: ', selectedHotel);
    			// todo- proceed with booking
    		} catch (e) {
    			console.log(e, 'user made an invalid selection');

    			// dead end
    		}

    	} else {
    		// first time user, save to redis
    		const info = {
    			type: 'user',
    			stage: 1,
    			hotels: []
    		};
    		redisApi.setKey(userMobile, JSON.stringify(info), function failure(err) {
    		    console.log(err);
    		}, function success(reply) {
    		    console.log('user saved: ', userMobile);
    		});

    		// search hotels and notify hoteliers
    		newUserRequestReceived(userMobile, message);

    	}
    });
}

function hotelierMessageReceived(params) {
    const hotelierMobile = params.mobile;
	const message = params.message.toLowerCase();

	if (message == 'y' || message == 'yes') {

		// get corresponding user mobile
		redisApi.getKey(hotelierMobile, function failure(err) {
	        console.log(err);
	    }, function success(value) {
	    	const userMobile = value;

	    	// get hotels details, update it and re-save
    		redisApi.getKey(userMobile, function failure(err) {
    	        console.log(err);
    	    }, function success(value) {
    	    	const info = JSON.parse(value);
    	    	const hotels = info.hotels;

    	    	// reduce price to half of corresponding hotelier
    	    	for (let i = 0; i < hotels.length; i++) {
    	    		if (hotels[i].hotelierMobile == hotelierMobile) {
    	    			hotels[i].price = hotels[i].price / 2;
    	    			break;
    	    		}
    	    	}

    	    	// save updated info back to redis db
    	    	redisApi.setKey(userMobile, JSON.stringify(info), function failure(err) {
    	    	    console.log(err);
    	    	}, function success(reply) {
    	    	    console.log('user re-saved: ', userMobile);
    	    	});
    	    });
	    });
	}
}

function newUserRequestReceived(userMobile, params) {
	//const url = 'https://hermes.goibibo.com/hotels/v6/search/data/mobile/6771549831164675055/20180309/20180310/1-1_0';
	let url = 'https://hermes.goibibo.com/hotels/v6/search/data/mobile/';

	const lattitude = params.la || 12.949437;
	const longitude = params.lo || 77.69006639999999;
	const cityCode = params.cityCode || 6771549831164675055;
	const checkinDate = params.checkinDate || 20180311;
	const checkoutDate = params.checkoutDate || 20180312; // 10 March 2018
	const pax = params.pax || '1-1_0'; // 1-2_0 1 room, 1/2 adults, 0 child
	//const userMobile = params.userMobile || 7206479844; 

	url += cityCode + '/' + checkinDate + '/' + checkoutDate + '/' + pax;

	const queryObject = {
		s: 'nearby',
		f: {},
		sb: 0,
		la: lattitude,
		lo: longitude,
		cur: 'INR',
		pid: 0
	};

    request.get({
    	url: url,
    	qs: queryObject
    }, function optionalcallback(error, response, body) {
    	console.log('Testing: ' + url);
	    if (error) {
	        console.log('err', error);
	    } else {
	    	if (response && response.body && response.body.data) {
	    		console.log(response.body);

	    		const data = response.body.data;
	    		const hotels = [];

	    		for (let i = 0; i < data.length; i++) {
	    			const hotel = {};
	    			hotel.name = data[i].hn;
	    			hotel.location = data[i].l;
	    			hotel.voyagerId = data[i].hc;
	    			hotel.id = i + 1;
	    			hotel.price = 5000;
	    			hotels.push(h);
	    		}

	    		const hotelierWhatsappMessage = 'Midnight booking received. Want to sell inventory at 50% rate?' +
	    		        'Reply Y for yes, N for No. Expires in 60 secs';

	    		// todo, integrate with API and find hotelier mobile
	    		for (let i = 0; i < hoteliersMobileHardCoded.length && i < hotels.length; i++) {
	    			hotels[i].hotelierMobile = hoteliersMobileHardCoded[i];
	    		}

	    		// save hotels to redis-db matched with userMobile
    			redisApi.getKey(userMobile, function failure(err) {
    		        console.log(err);
    		    }, function success(value) {
    		    	const info = JSON.parse(value);
    		    	info.hotels = hotels;

    		    	// save updated info back to redis db
    		    	redisApi.setKey(userMobile, JSON.stringify(info), function failure(err) {
    		    	    console.log(err);
    		    	}, function success(reply) {
    		    	    console.log('user re-saved with updated hotels: ', userMobile);
    		    	});
    		    });

    		    // send hoteliers whatsapp message
    		    hotels.forEach(hotel => {
    		    	sendWhatsappMessage(hotel.hotelierMobile, hotelierWhatsappMessage);

    		    	// map hotelierMobile to userMobile
    		    	redisApi.setKey(hotel.hotelierMobile, userMobile, function failure(err) {
    		    	    console.log(err);
    		    	}, function success(reply) {
    		    	    console.log('hotelier ' + hotel.hotelierMobile + ' mapped with user ' + userMobile);
    		    	});
    		    });
	    	} else {
	    		console.log(response.body.error);
	    	}
	    }
    });
}

function sendWhatsappMessage(mobile, message) {
	const payload = {
		data_params: {
			whatsapp_text: message
		},
		channels: [
		    'whatsapp'
		],
		name: 'flow_name',
		address: {
			whatsapp_number: mobile
		}
	};
    request.post({
    	url: 'https://pigeonpp.goibibo.com/notifier/notify/',
    	json: payload,
    	rejectUnauthorized: false, // to avoid Error: unable to verify the first certificate
    	headers: {
    		'Content-Type': 'application/json',
    		'token': 'JBcjsvdFgHweyu23t76rtGMdjjsbD487rgwegfjc'
    	}
    }, function optionalcallback(error, response, body) {
    	if (error) {
    	    console.log('err', error);
    	} else {
    		if (response && response.body) {
    			if (response.body.status) {
    				console.log('Message sent to: ', mobile);
    			}
    		}
    	}
    });
}

// test whatsapp API
app.get('/', function(req, res, next) {
	sendWhatsappMessage('7206479844', 'Test again');
	res.json({message: 'trying'});
});

// test whatsapp API
app.get('/whatsapp', function(req, res, next) {
	res.send('DirtyBits');
});
