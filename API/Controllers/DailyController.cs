using DataAccess.Entities;
using Microsoft.AspNetCore.Mvc;

namespace RESTPopocatepetl.Controllers
{
    [ApiController]
    [Route("daily", Name = "Daily Volcanic Data")]
    public class DailyController : ControllerBase
    {
        [HttpGet(template: "{date}", Name = "All Available Data for Specified Date")]
        public ActionResult Data(string date)
        {
            var dateTime = new DateTime();
            var error = ValidateDate(date, ref dateTime);

            if (error != null)
            {
                return error;
            }

            var data = CenapredData.TryGetData(dateTime);

            if (data == null)
            {
                return NotFound();
            }

            return Ok(data);
        }

        [HttpGet(template: "{date}/exhalations", Name = "Exhalations for Specified Date")]
        public ActionResult Exhalations(string date)
        {
            var dateTime = new DateTime();
            var error = ValidateDate(date, ref dateTime);

            if (error != null)
            {
                return error;
            }

            var data = CenapredData.TryGetData(dateTime);

            if (data == null)
            {
                return NotFound();
            }

            return Ok(data.Exhalations);
        }

        [HttpGet(template: "{date}/phase", Name = "Phase on Specified Date")]
        public ActionResult Phase(string date)
        {
            var dateTime = new DateTime();
            var error = ValidateDate(date, ref dateTime);

            if (error != null)
            {
                return error;
            }

            var data = CenapredData.TryGetData(dateTime);

            if (data == null)
            {
                return NotFound();
            }

            return Ok(data.Phase);
        }

        [HttpGet(template: "{date}/directionOfPlume", Name = "Direction of Plume on Specified Date")]
        public ActionResult DirectionOfPlume(string date)
        {
            var dateTime = new DateTime();
            var error = ValidateDate(date, ref dateTime);

            if (error != null)
            {
                return error;
            }

            var data = CenapredData.TryGetData(dateTime);

            if (data == null)
            {
                return NotFound();
            }

            return Ok(data.DirectionOfPlume);
        }

        [HttpGet(template: "{date}/explosions", Name = "Number of Explosions on Specified Date")]
        public ActionResult Explosions(string date)
        {
            var dateTime = new DateTime();
            var error = ValidateDate(date, ref dateTime);

            if (error != null)
            {
                return error;
            }

            var data = CenapredData.TryGetData(dateTime);

            if (data == null)
            {
                return NotFound();
            }

            return Ok(data.Explosions);
        }

        [HttpGet(template: "{date}/minutesOfTremors", Name = "Minutes of Tremors on Specified Date")]
        public ActionResult MinutesOfTremors(string date)
        {
            var dateTime = new DateTime();
            var error = ValidateDate(date, ref dateTime);

            if (error != null)
            {
                return error;
            }

            var data = CenapredData.TryGetData(dateTime);

            if (data == null)
            {
                return NotFound();
            }

            return Ok(data.MinutesOfTremor);
        }


        private ObjectResult? ValidateDate(string date, ref DateTime dateTime)
        {
            if (string.IsNullOrWhiteSpace(date))
            {
                return BadRequest("You must enter a date");
            }

            if (!DateTime.TryParse(date, out dateTime))
            {
                return BadRequest("Please enter a valid date in the form dd-MMM-YYYY such as 01-JAN-2023");
            }

            return null;
        }
    }
}