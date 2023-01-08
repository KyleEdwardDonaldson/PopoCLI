# RESTPopocatepetl

This is an API that manually scrapes information from CENAPRED regarding the daily status of Popocatepetl. Code needs tidied up a bit, could definitely be faster but CENAPRED haven't responded to my emails haha - so scraping is the best we have for now.

The API pulls all the data from the daily reports that CENAPRED releases. These are typically very consistent, but I have noticed some slight differences over the years of reports they have - so results may vary with regards to pulling the data. It seems like it doesn't go much further back than 2017 either.

I would like to add more from CENAPRED, maybe also some other sources. Next focus is just on optimising and cleaning the existing code. I'm potentially going to reach out to the university that works with CENAPRED and see if they'll give me access to a DB or something.

Currently it can return for a specified date:
* Exhalations
* Current Phase (green, yellow, red)
* Direction of Plume
* Number of Explosions
* Minutes of Tremors
