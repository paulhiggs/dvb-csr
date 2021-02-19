// node.js - https://nodejs.org/en/
// express framework - https://expressjs.com/en/4x/api.html
const express=require('express');

const cluster = require('cluster')
const totalCPUs = require('os').cpus().length;

// libxmljs - https://www.npmjs.com/package/libxmljs2
const libxml=require('libxmljs2');

// morgan - https://www.npmjs.com/package/morgan
const morgan=require('morgan')

// favourite icon - https://www.npmjs.com/package/serve-favicon
const favicon=require('serve-favicon')

const fs=require('fs'), path=require('path');

// command line arguments - https://www.npmjs.com/package/command-line-args
const commandLineArgs=require('command-line-args');

// Fetch() API for node.js- https://www.npmjs.com/package/node-fetch
const fetch=require('node-fetch')

const https=require('https');
const keyFilename=path.join('.','selfsigned.key'), certFilename=path.join('.','selfsigned.crt');


const ISOcountries=require("./dvb-common/ISOcountries.js");
const dvbi=require("./dvb-common/DVB-I_definitions.js")

// SLEPR == Service List Entry Point Registry
const MASTER_SLEPR_FILE=path.join('.','slepr-master.xml'),
	  MASTER_SLEPR_URL="https://raw.githubusercontent.com/paulhiggs/dvb-csr/master/slepr-master.xml"
	  
var masterSLEPR=""
const EMPTY_SLEPR="<ServiceListEntryPoints xmlns=\"urn:dvb:metadata:servicelistdiscovery:2019\"></ServiceListEntryPoints>"

// permitted query parameters
const allowed_arguments=[dvbi.e_ProviderName, dvbi.a_regulatorListFlag, dvbi.e_Language, dvbi.e_TargetCountry, dvbi.e_Genre];

// command line options
const DEFAULT_HTTP_SERVICE_PORT=3000;
const optionDefinitions=[
  { name: 'urls', alias: 'u', type: Boolean, defaultValue: false},
  { name: 'port', alias: 'p', type: Number, defaultValue:DEFAULT_HTTP_SERVICE_PORT },
  { name: 'sport', alias: 's', type: Number, defaultValue:DEFAULT_HTTP_SERVICE_PORT+1 },
  { name: 'file', alias: 'f', type: String, defaultValue:MASTER_SLEPR_FILE}
]

const patterns=require("./dvb-common/pattern_checks.js")

const DVB_COMMON_DIR='dvb-common',
      COMMON_REPO_RAW="https://raw.githubusercontent.com/paulhiggs/dvb-common/master/"
	  
const ISO3166_FILE=path.join('dvb-common','iso3166-countries.json'),
      ISO3166_URL=COMMON_REPO_RAW+"iso3166-countries.json"
	  
var knownCountries=new ISOcountries(false, true);

const IANAlanguages=require('./dvb-common/IANAlanguages.js');
var knownLanguages=new IANAlanguages();

const IANA_Subtag_Registry_Filename=path.join(DVB_COMMON_DIR, knownLanguages.LanguagesFileName),
      IANA_Subtag_Registry_URL=knownLanguages.LanguagesURL

/**
 * determines if a value is in a set of values - simular to 
 *
 * @param {String or Array} values The set of values to check existance in
 * @param {String} value The value to check for existance
 * @param {Boolean} caseSensitive ignofe case
 * @return {boolean} if value is in the set of values
 */
function isIn(args, value, caseSensitive=true){
	let value_lc=value.toLowerCase()
	if (typeof(args)=="string")
		return caseSensitive?(args==value):(args.toLowerCase()==value_lc)
	
	if (Array.isArray(args)) 
		return caseSensitive?args.includes(value):args.find(element => element.toLowerCase()==value_lc)!=undefined

	return false;
}


/**
 * constructs an XPath based on the provided arguments
 * @param {string} SCHEMA_PREFIX Used when constructing Xpath queries
 * @param {string} elementName the name of the element to be searched for
 * @param {int} index the instance of the named element to be searched for (if specified)
 * @returns {string} the XPath selector
 */
function xPath(SCHEMA_PREFIX, elementName, index=null) {
	return SCHEMA_PREFIX+":"+elementName+(index?"["+index+"]":"")
}


function checkQuery(req) {
	
/*	function isGenre(genre) {
		// DVB-I Genre is defined through classification schemes
		// permitted values through TVA:ContentCS, TVA:FormatCS, DVB-I:ContentSubject 
		return true;
	}

	function isProvider(provider) {
		return true;
	} */
	
	if (req.query) {
		
		// check for any erronous arguments
		for (key in req.query) {
			if (!isIn(allowed_arguments, key, false)) {
				req.parseErr="invalid argument ["+key+"]";
				return false;
			}
		}
		
		//regulatorListFlag needs to be a boolean, "true" or "false" only
		if (req.query.regulatorListFlag) {
			if (!(typeof req.query.regulatorListFlag == "string" || req.query.regulatorListFlag instanceof String)) {
				req.parseErr="invalid type for regulatorListFlag ["+typeof(req.query.regulatorListFlag)+"]";
				return false;
			}
			if (req.query.regulatorListFlag.toLowerCase()!="true" && req.query.regulatorListFlag.toLowerCase()!="false") {
				req.parseErr="invalid value for regulatorListFlag ["+req.query.regulatorListFlag+"]";
				return false;				
			}
		}
		
		//TargetCountry(s)
		if (req.query.TargetCountry) {
			if (typeof req.query.TargetCountry == "string" || req.query.TargetCountry instanceof String) {
				if (!knownCountries.isISO3166code(req.query.TargetCountry,false)) {
					req.parseErr="incorrect country ["+req.query.TargetCountry+"]";
					return false;
				}					
			}	
			else if (Array.isArray(req.query.TargetCountry)) {
				for (let i=0; i<req.query.TargetCountry.length; i++ ) {
					if (!knownCountries.isISO3166code(req.query.TargetCountry[i], false)) {
						req.parseErr="incorrect country ["+req.query.TargetCountry[i]+"]";
						return false;
					}
				}
			}
			else {
				req.parseErr="invalid type ["+typeof(req.query.Language)+"] for country"
				return false
			}			
		}

		//Language(s)
		if (req.query.Language) {
			if (typeof req.query.Language =="string" || req.query.Language instanceof String) {
				if (!patterns.isTVAAudioLanguageType(req.query.Language, false)) {
					req.parseErr="incorrect language ["+req.query.Language+"]";
					return false;
				}					
			}	
			else if (Array.isArray(req.query.Language)) {
				for (let i=0; i<req.query.Language.length; i++ ) {
					if (!patterns.isTVAAudioLanguageType(req.query.Language[i], false)) {
						req.parseErr="incorrect language ["+req.query.Language[i]+"]";
						return false;
					}
				}
			}
			else {
				req.parseErr="invalid type ["+typeof(req.query.Language)+"] for language"
				return false
			}
		}
/* value space of these arguments is not checked
		// Genre(s)
		if (req.query.Genre) {
			if (typeof req.query.Genre =="string" || req.query.Genre instanceof String){
				if (!isGenre(req.query.Genre)) {
					req.parseErr="invalid genre ["+req.query.Genre+"]"
					return false;
				}					
			}	
			else if (Array.isArray(req.query.Genre)) {
				for (let i=0; i<req.query.Genre.length; i++ ) {
					if (!isGenre(req.query.Genre[i])) {
						req.parseErr="invalid genre ["+req.query.Genre[i]+"]"
						return false;
					}
				}
			}
			else {
				req.parseErr="invalid type ["+typeof(req.query.Language)+"] for genre"
				return false
			}
		}		
		//Provider Name(s)
		if (req.query.ProviderName) {
			if (typeof req.query.ProviderName =="string" || req.query.ProviderName instanceof String){
				if (!isProvider(req.query.ProviderName)) {
					return false;
				}					
			}	
			else if (Array.isArray(req.query.ProviderName)) {
				for (let i=0; i<req.query.ProviderName.length; i++ ) {
					if (!isProvider(req.query.ProviderName[i])) {
						return false;
					}
				}
			}
		}			
*/
	}	
	return true;
}


/**
 * read in the master XML document as text
 *
 * @param {string} filename   filename of the master XML document
 */
function loadServiceListRegistry(filename) {

	console.log('loading SLR from', filename)
	if (patterns.isHTTPURL(filename)) {

		function handleErrors(response) {
			if (!response.ok) {
				throw Error(response.statusText)
			}
			return response
		}

		fetch(filename)
			.then(handleErrors)
			.then(response => response.text())
			.then(responseText => masterSLEPR=responseText.replace(/(\r\n|\n|\r|\t)/gm,""))
			.catch(error => {console.log("error ("+error+") retrieving "+filename); masterSLEPR=EMPTY_SLEPR})
	}
	else fs.readFile(filename, {encoding: 'utf-8'}, function(err,data){
		if (!err) {
			masterSLEPR=data.replace(/(\r\n|\n|\r|\t)/gm,"")
		} else
			console.log(err);
	});	
}

function loadDataFiles(useURLs) {
	if (useURLs) 
		knownCountries.loadCountriesFromURL(ISO3166_URL, true)
	else knownCountries.loadCountriesFromFile(ISO3166_FILE, true)

	if (useURLs) 
		knownLanguages.loadLanguagesFromURL(IANA_Subtag_Registry_URL, true)
	else knownLanguages.loadLanguagesFromFile(IANA_Subtag_Registry_Filename, true)
}

const options=commandLineArgs(optionDefinitions);

const RELOAD='RELOAD', UPDATE='UPDATE',
	  INCR_REQUESTS='REQUESTS++', INCR_FAILURES='FAILURES++',
	  STATS='STATS'

if (cluster.isMaster) {

	var metrics={
		numRequests:0,
		numFailed:0,
		reloadRequests:0
	}
	
	console.log(`Number of CPUs is ${totalCPUs}`);
	console.log(`Master ${process.pid} is running`);


	// Fork workers.
	for (let i=0; i<totalCPUs; i++) {
	  cluster.fork();
	}
  
	cluster.on('exit', (worker, code, signal) => {
	  console.log(`worker ${worker.process.pid} died`);
	  console.log("Let's fork another worker!");
	  cluster.fork();
	})

	cluster.on('message', (worker, msg, handle) => {
		if (msg.topic)
			switch (msg.topic) {
				case RELOAD: 
					metrics.reloadRequests++
					for (const id in cluster.workers) {
							// Here we notify each worker of the updated value
							cluster.workers[id].send({
								  topic: UPDATE
						});
					}
					break
				case INCR_REQUESTS:
					metrics.numRequests++
					break
				case INCR_FAILURES:
					metrics.numFailed++
					break
				case STATS:
					console.log("knownLanguages.length=", knownLanguages.languagesList.length);
					console.log("knownCountries.length=", knownCountries.count());
					console.log("requests=", metrics.numRequests, " failed=", metrics.numFailed, " reloads=", metrics.reloadRequests)
					console.log("SLEPR file=", options.file)
					break;
			}
	})
 
  } else {

	var app=express();

	morgan.token('pid', function getPID(req) {
		return process.pid
	})
	morgan.token('protocol', function getProtocol(req) {
		return req.protocol;
	});
	morgan.token('parseErr',function getParseErr(req) {
		if (req.parseErr) return "("+req.parseErr+")";
		return "";
	});
	morgan.token('agent',function getAgent(req) {
		return "("+req.headers['user-agent']+")";
	});
	
	app.use(morgan(':pid :remote-addr :protocol :method :url :status :res[content-length] - :response-time ms :agent :parseErr'));
	
	app.use(favicon(path.join('phlib','ph-icon.ico')))
	
	app.get('/query', function(req,res) {
		process.send({ topic: INCR_REQUESTS })
		if (!checkQuery(req)) {
			res.status(400);
			process.send({ topic: INCR_FAILURES })
		}
		else {
			let slepr=libxml.parseXmlString(masterSLEPR)
	
			let SLEPR_SCHEMA={}, SCHEMA_PREFIX=slepr.root().namespace().prefix()
			SLEPR_SCHEMA[SCHEMA_PREFIX]=slepr.root().namespace().href();
				
			if (req.query.ProviderName) {
				// if ProviderName is specified, remove any ProviderOffering entries that do not match the name
				let prov, p=0, providerCleanup=[]
				while (prov=slepr.get('//'+xPath(SCHEMA_PREFIX, dvbi.e_ProviderOffering, ++p), SLEPR_SCHEMA)) {
					let provName, n=0, matchedProvider=false
					while ((provName=prov.get(xPath(SCHEMA_PREFIX, dvbi.e_Provider)+'/'+xPath(SCHEMA_PREFIX, dvbi.e_Name, ++n), SLEPR_SCHEMA)) && !matchedProvider) {
						if (isIn(req.query.ProviderName, provName.text())) 
							matchedProvider=true;					
					}
					if (!matchedProvider) 
						providerCleanup.push(prov);
				}
				providerCleanup.forEach(provider => provider.remove());
			}
	
			if (req.query.regulatorListFlag || req.query.Language || req.query.TargetCountry || req.query.Genre) {
				let prov, p=0, servicesToRemove=[]
				while (prov=slepr.get('//'+xPath(SCHEMA_PREFIX, dvbi.e_ProviderOffering, ++p), SLEPR_SCHEMA)) {
					let serv, s=0
					while (serv=prov.get(xPath(SCHEMA_PREFIX, dvbi.e_ServiceListOffering, ++s), SLEPR_SCHEMA)) {
						let removeService=false
					
						// remove services that do not match the specified regulator list flag
						if (req.query.regulatorListFlag) {
							// The regulatorListFlag has been specified in the query, so it has to match. Default in instance document is "false"
							let flag=serv.attr(dvbi.a_regulatorListFlag)?serv.attr(dvbi.a_regulatorListFlag).value():"false"
							if (req.query.regulatorListFlag!=flag ) 
								removeService=true;
						}
	
						// remove remaining services that do not match the specified language
						if (!removeService && req.query.Language) {
							let lang, l=0, keepService=false, hasLanguage=false
							while (!keepService && (lang=serv.get(xPath(SCHEMA_PREFIX, dvbi.e_Language, ++l), SLEPR_SCHEMA))) {
								if (isIn(req.query.Language, lang.text())) keepService=true;
								hasLanguage=true;
							}
							if (hasLanguage && !keepService) removeService=true;
						}
						
						// remove remaining services that do not match the specified target country
						if (!removeService && req.query.TargetCountry) {
							let targetCountry, c=0, keepService=false, hasCountry=false
							while (!keepService && (targetCountry=serv.get(xPath(SCHEMA_PREFIX, dvbi.e_TargetCountry, ++c), SLEPR_SCHEMA))) {	
								// note that the <TargetCountry> element can signal multiple values. Its XML pattern is "\c\c\c(,\c\c\c)*"
								let countries=targetCountry.text().split(",")
								countries.forEach(country => {
									if (isIn(req.query.TargetCountry, country)) keepService=true;
								})
								hasCountry=true;
							}
							if (hasCountry && !keepService) removeService=true;
						}
	
						// remove remaining services that do not match the specified genre
						if (!removeService && req.query.Genre) {
							let genre, g=0, keepService=false, hasGenre=false
							while (!keepService && (genre=serv.get(xPath(SCHEMA_PREFIX, dvbi.e_Genre, ++g), SLEPR_SCHEMA))) {			
								if (isIn(req.query.Genre, genre.text())) keepService=true;
								hasGenre=true;
							}
							if (hasGenre && !keepService) removeService=true;
						}
					
						if (removeService) servicesToRemove.push(serv);						
					}
				}
				servicesToRemove.forEach(service => service.remove());
			}
				
			// remove any <ProviderOffering> elements that no longer have any <ServiceListOffering>
			let prov, p=0, providersToRemove=[]
			while (prov=slepr.get('//'+xPath(SCHEMA_PREFIX, dvbi.e_ProviderOffering, ++p), SLEPR_SCHEMA)) {
				if (!prov.get(xPath(SCHEMA_PREFIX, dvbi.e_ServiceListOffering, 1), SLEPR_SCHEMA)) 
					providersToRemove.push(prov);
			}
			providersToRemove.forEach(provider => provider.remove());

			res.type('text/xml');
			res.send(slepr.toString());
		}
		res.end();
	});

	app.get('/reload', function(req,res) {
		process.send({ topic: RELOAD });
		res.status(404).end();
	});
	
	
	app.get('/stats', function(req,res) {
		process.send({ topic: STATS });
		res.status(404).end();
	});
	
	app.get('*', function(req,res) {
		res.status(404).end();
	});
	

	process.on('message', (msg) => {
		if (msg.topic)
			switch (msg.topic) {
				case UPDATE:
					loadDataFiles(options.urls)
					loadServiceListRegistry(options.file)
					break
			}
	})

	loadDataFiles(options.urls)
	loadServiceListRegistry(options.file)

	// start the HTTP server
	var http_server=app.listen(options.port, function() {
		console.log(`HTTP listening on port number ${http_server.address().port}, PID=${process.pid}`);
	});

	// start the HTTPS server
	// sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout ./selfsigned.key -out selfsigned.crt

	function readmyfile(filename) {
		try {
			let stats=fs.statSync(filename);
			if (stats.isFile()) return fs.readFileSync(filename); 
		}
		catch (err) {console.log(err.code,err.path);}
		return null;
	}

	var https_options = {
		key:readmyfile(keyFilename),
		cert:readmyfile(certFilename)
	};

	if (https_options.key && https_options.cert) {
		if (options.sport==options.port)
			options.sport=options.port+1
			
		var https_server=https.createServer(https_options, app);
		https_server.listen(options.sport, function(){
			console.log(`HTTPS listening on port number ${https_server.address().port}`);
		});
	}


 }