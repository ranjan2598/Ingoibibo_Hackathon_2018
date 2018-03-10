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
	
	// removing +91 from number
	params.mobile = params.mobile.substring(3);

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
    	    	if (value) {
    	    		const info = JSON.parse(value);
    	    		const hotels = info.hotels;
    	    		let hotelcode;

    	    		// reduce price to half of corresponding hotelier
    	    		for (let i = 0; i < hotels.length; i++) {
    	    			if (hotels[i].mobile == hotelierMobile) {
    	    				hotelcode = hotels[i].hotelcode;
    	    				break;
    	    			}
    	    		}

    	    		redisApi.getKey(hotelcode, function failure(err) {
    	    		    console.log(err);
    	    		}, function success(reply) {
    	    		    const completeHotelDetails = JSON.parse(reply);
    	    		    completeHotelDetails.roomlist[0].totalcharges = 
    	    		            (completeHotelDetails.roomlist[0].totalcharges) / 2;

    	    		    // save updated info back to redis db
    	    		    redisApi.setKey(hotelcode, JSON.stringify(completeHotelDetails), function failure(err) {
    	    		        console.log(err);
    	    		    }, function success(reply) {
    	    		        console.log('Hotel details updated: ', hotelcode);
    	    		    });
    	    		});

    	    	} else {
    	    		console.log('This should not happen');
    	    	}
    	    });
	    });
	}
}

function newUserRequestReceived(userMobile, params) {
	let url = 'http://ppin1.goibibo.com/api/hotels/nearby-info/';

	// send Users options after 60 secs
	setTimeout(() => {
		mergeHotelDetailsAndSendToUser(userMobile);
	}, 25 * 1000); // todo 1 mins

    request.post({
    	url: url
    }, function optionalcallback(error, response, body) {
    	console.log('Testing: ' + url);
	    if (error) {
	        console.log('err', error);
	    } else {
	    	if (response && response.body) {

	    		const hotels = JSON.parse(response.body);
	    		console.log('hotels: ', hotels);

	    		const hotelierWhatsappMessage = 'Midnight booking received. Want to sell inventory at 50% rate?' +
	    		        'Reply Y for yes, N for No. Expires in 60 secs';

	    		// will call additional API two add additionals data
		        addNameAndSaveHotelsToRedis(hotels);


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

    		    mapHotelierToUser(0, hotels, userMobile, hotelierWhatsappMessage);

	    	} else {
	    		console.log(response.body.detail);
	    	}
	    }
    });
}

function mergeHotelDetailsAndSendToUser(userMobile) {
	redisApi.getKey(userMobile, function failure(err) {
        console.log(err);
    }, function success(value) {
    	const info = JSON.parse(value);
    	const hotels = info.hotels;

        mergeHotelDetails(0, hotels, userMobile);
    });
}

function mergeHotelDetails(index, hotels, userMobile) {
	if (index < hotels.length) {
		const hotel = hotels[index];

		redisApi.getKey(hotel.hotelcode, function failure(err) {
		    console.log(err);
		}, function success(reply) {
			hotels[index] = JSON.parse(reply);
		    index += 1;
		    mergeHotelDetails(index, hotels, userMobile);
		});

	} else {
		//console.log(hotels);
		let messageToBeSent = '';
		for (let i = 0; i < hotels.length; i++) {
			messageToBeSent += (i + 1 + '.');
			messageToBeSent += (hotels[i].name + '\\n');
			messageToBeSent += ('Rating: ' + hotels[i].rating + '\\n');
			messageToBeSent += ('Total Charge: ' + hotels[i].roomlist[0].totalcharges + '\\n');
			messageToBeSent += '\\n';
		}

		sendWhatsappMessage(userMobile, messageToBeSent);
	}
}

function mapHotelierToUser(index, hotels, userMobile, hotelierWhatsappMessage) {
	
	if (index < hotels.length) {
		const hotel = hotels[index];
		index += 1;

		redisApi.setKey(hotel.mobile, userMobile, function failure(err) {
		    console.log(err);
		}, function success(reply) {
		    console.log('hotelier ' + hotel.mobile + ' mapped with user ' + userMobile);
		    sendWhatsappMessage(hotel.mobile, hotelierWhatsappMessage);
		    mapHotelierToUser(index, hotels, userMobile, hotelierWhatsappMessage);
		});

	} 
}

function addNameAndSaveHotelsToRedis(hotels) {
	//let url = 'http://voyager.goibibo.com/api/v1/hotels/get_hotels_data/?params={"id_list":["1800889279552749437"],"id_type":"_id"}';
	let url = 'http://voyager.goibibo.com/api/v1/hotels/get_hotels_data/?params={"id_list":';
	let idListArray = '[';
	for (let i = 0; i < hotels.length; i++) {
		idListArray += hotels[i].voyagerid;
		if (i == (hotels.length - 1)) {
		} else {
			idListArray += ',';
		}
	}
	idListArray += ']';

	url += idListArray + ',"id_type":"_id"}';
	request.get({
		url: url
	}, function optionalcallback(error, response, body) {
		response.body = JSON.parse(response.body);
		if (response && response.body && response.body.data) {
			const receivedData = response.body.data;

			// iterate over hotels and add extra infos
			for (let i = 0; i < hotels.length; i++) {
				hotels[i].name = receivedData[hotels[i].voyagerid].hotel_geo_node.name;
				hotels[i].rating = receivedData[hotels[i].voyagerid].hotel_data_node.rating;
			}

			addPriceAndSaveHotelsToRedis(hotels);
		} else {
			console.log(response.body);
		}
	});
}

function addPriceAndSaveHotelsToRedis(hotels) {
	let url = 'http://ppin.goibibo.com/api/multi_hotel_search_api';
	let hotelcodelist = '';

	for (let i = 0; i < hotels.length; i++) {
		hotelcodelist += hotels[i].hotelcode;

		if (i == (hotels.length - 1)) {
		} else {
			hotelcodelist += ',';
		}
	}

	const formData = {
		noofrooms: 1,
		username: 'goibibo',
		password: 'g01b1b0321',
		checkin: '2018-03-10',
		checkout: '2018-03-11',
		adultroom1: 1,
		hotelcodelist: hotelcodelist
	};

	request.post({
		url: url,
		headers: {
		    'Content-Type': 'application/x-www-form-urlencoded'
		},
		form: formData
	}, function optionalcallback(error, response, body) {
		response.body = JSON.parse(response.body);
		if (response && response.body && response.body.message) {
			const receivedData = response.body.message;

			// iterate over hotels and add extra infos
			for (let i = 0; i < hotels.length; i++) {
				for (let j = 0; j < receivedData.length; j++) {
					if (receivedData[j].hotelcode == hotels[i].hotelcode) {
						receivedData[j].mobile = hotels[i].mobile;
						receivedData[j].voyagerid = hotels[i].voyagerid;
						receivedData[j].name = hotels[i].name;
						receivedData[j].rating = hotels[i].rating;

						hotels[i] = receivedData[j];
						break;
					}
				}
			}

			saveCompleteHotelDetailsToRedis(0, hotels);
		} else {
			console.log(response.body);
		}
	});
}

function saveCompleteHotelDetailsToRedis(index, hotels) {
	if (index < hotels.length) {
		const hotel = hotels[index];
		index += 1;

		redisApi.setKey(hotel.hotelcode, JSON.stringify(hotel), function failure(err) {
		    console.log(err);
		}, function success(reply) {
		    //console.log('saved hotel: ', hotel);
		    saveCompleteHotelDetailsToRedis(index, hotels);
		});
	}
}

function sendWhatsappMessage(mobile, message) {
	console.log('send whatsapp called: ', mobile, message);
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
