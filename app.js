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
    			const selectedHotel = info.hotels[parseInt(message) - 1];
    			console.log('Proceed booking: ', selectedHotel);

    			// todo- proceed with booking
    			completeBooking(selectedHotel, userMobile);
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
	let messageToBeSent = 'We are negotiating exclusive deals with hotels near you. Please wait for 60 seconds...';

	sendWhatsappMessage(userMobile, messageToBeSent);

	let url = 'http://ppin1.goibibo.com/api/hotels/nearby-info/';

	// send Users options after 60 secs
	setTimeout(() => {
		mergeHotelDetailsAndSendToUser(userMobile);
	}, 30 * 1000); // todo 1 mins

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

    		    mapHotelierToUser(0, hotels, userMobile);

	    	} else {
	    		console.log(response.body.detail);
	    	}
	    }
    });
}

function completeBooking(hotel, userMobile) {
	redisApi.getKey(hotel.hotelcode, function failure(err) {
        console.log(err);
    }, function success(value) {
    	const completeHotelDetails = JSON.parse(value);

    	completeHotelDetails.city = 'Bangalore';
    	completeHotelDetails.city = '';
    	completeHotelDetails.booking_type = 'offline';
        completeHotelDetails.totalrent = 7742;
        completeHotelDetails.uname = 'test';
        completeHotelDetails.umail = 'ranjan.agarwal@go-mmt.com';
        completeHotelDetails.bypass_inventory = true;
        completeHotelDetails.allow_pah = 1;
        completeHotelDetails.pahathotelflag = 1;
        completeHotelDetails.checkin = '2018-03-11';
		completeHotelDetails.checkout = '2018-03-12';
		completeHotelDetails.noofrooms = 1;
		completeHotelDetails.adultroom1 = 1;
		completeHotelDetails.roomcode = completeHotelDetails.roomlist[0].roomtypecode;
		completeHotelDetails.rateplancode = completeHotelDetails.roomlist[0].rateplancode;
		completeHotelDetails.pricingdetail = {
		    pricetype: 'sr',
		    pricebreakup: [{
		        '2018-03-11': {
			        'adultrate': completeHotelDetails.roomlist[0].totalcharges,
			        'extraadultrate': 0
			    }
		    }]
		};

    	
    	const url = 'http://ppin.goibibo.com/api/v1/booking/direct-booking/';
    	//console.log(completeHotelDetails);
    	request.post({
    		url: url,
    		form: completeHotelDetails,
    		headers: {
    			'Authorization': 'Token ea1374a6b6cd43a84b9c561ecbd838c937a6e5ac'
    		}
    	}, function optionalcallback(error, response, body) {
    		if (error) {
    		    console.log('err', error);
    		} else {
    			response.body = JSON.parse(response.body);
    			if (response && response.body) {
    				if (response.body.success) {
    					const data = {
    						hotelName: response.body.message.bookingresult.hotelname,
    						bookingid: response.body.message.bookingresult.bookingid,
    						price: completeHotelDetails.roomlist[0].totalcharges,
    						lattitude: completeHotelDetails.lattitude,
    						longitude: completeHotelDetails.longitude,
    						urlEncodedHotelName: response.body.message.bookingresult.hotelname.split(' ').join('+')
    					};
    					sendWhatsappMessage(userMobile, 'Your booking at ' + data.hotelName + ' has been confirmed. ' + 
    						    'Booking id for further reference is ' + data.bookingid + '. ' +
    						    'You can check-in anytime now and pay  Rs. ' + data.price + ' at hotel. ' +
    						    'Hotel Location: https://www.google.com/maps/?q=' + data.urlEncodedHotelName + '&ll=' +
    						    data.lattitude + ',' + data.longitude +' Have a pleasant stay!');
    				} else {
    					sendWhatsappMessage(userMobile, 'Sorry. Something bad happened. :(');
    					console.log(response.body);
    				}
    				
    			}
    		}
    	});
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
			if (hotels[i].roomlist && hotels[i].roomlist[0]) {
			} else {
				hotels[i].roomlist = [{}]; // code was breaking, todo: do proper fix
			}
			
			messageToBeSent += (i + 1 + '.');
			messageToBeSent += (hotels[i].name + '\\n');
			messageToBeSent += ('go rating: ' + hotels[i].rating + '/ 5\\n');
			messageToBeSent += '*' + hotels[i].roomlist[0].roomtypename + '*\\n';
			messageToBeSent += ('Amount to be paid at hotel: ' + hotels[i].roomlist[0].totalcharges) + '\\n';
				    //' (50% off exclusive deal)');
			messageToBeSent += '\\n';
		}

		sendWhatsappMessage(userMobile, messageToBeSent);
	}
}

function mapHotelierToUser(index, hotels, userMobile) {
	
	if (index < hotels.length) {
		const hotel = hotels[index];
		index += 1;

		redisApi.setKey(hotel.mobile, userMobile, function failure(err) {
		    console.log(err);
		}, function success(reply) {
		    console.log('hotelier ' + hotel.mobile + ' mapped with user ' + userMobile);
		    mapHotelierToUser(index, hotels, userMobile);
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
			//console.log(receivedData);

			// iterate over hotels and add extra infos
			for (let i = 0; i < hotels.length; i++) {
				hotels[i].name = receivedData[hotels[i].voyagerid].hotel_geo_node.name;
				hotels[i].rating = receivedData[hotels[i].voyagerid].hotel_data_node.rating;
				hotels[i].lattitude = receivedData[hotels[i].voyagerid].hotel_geo_node.location.lat;
				hotels[i].longitude = receivedData[hotels[i].voyagerid].hotel_geo_node.location.long;
				//console.log(hotels[i].lattitude, hotels[i].longitude);
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
		checkin: '2018-03-11',
		checkout: '2018-03-12',
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
			//console.log(receivedData);

			// iterate over hotels and add extra infos
			for (let i = 0; i < hotels.length; i++) {
				for (let j = 0; j < receivedData.length; j++) {
					if (receivedData[j].hotelcode == hotels[i].hotelcode) {
						receivedData[j].mobile = hotels[i].mobile;
						receivedData[j].voyagerid = hotels[i].voyagerid;
						receivedData[j].name = hotels[i].name;
						receivedData[j].rating = hotels[i].rating;
						receivedData[j].lattitude = hotels[i].lattitude;
						receivedData[j].longitude = hotels[i].longitude;

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
		    // send message to hoteliers
		    if (hotel.roomlist && hotel.roomlist[0]) {
		    } else {
		    	hotel.roomlist = [{}]; // code was breaking, todo: do proper fix
		    }

		    const hotelierData = {
		    	availableRooms: hotel.roomlist[0].avail,
		    	price: hotel.roomlist[0].totalcharges,
		    	roomType: hotel.roomlist[0].roomtypename
		    };
		    let hotelierWhatsappMessage = 'Booking Alert! Midnight check-in: A customer is looking for a hotel' +
		            'room to check-in now and you have ' + hotelierData.availableRooms + ' unsold rooms. ' +
		            'Do you want to sell ' + hotelierData.roomType + ' at Rs ' + (hotelierData.price / 2) + '? ' +
		            'Reply with Y to accept the booking before a nearby hotel confirms it.' +
		            'This opportunity will expire in 60 seconds.';
		            
		    sendWhatsappMessage(hotel.mobile, hotelierWhatsappMessage);
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
