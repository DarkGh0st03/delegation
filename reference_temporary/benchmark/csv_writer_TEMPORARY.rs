use csv::Writer;
use serde::Serialize;
use std::collections::HashMap;
use std::fs::create_dir;
use std::fs::{File, metadata};
use std::path::Path;

/// An object used to easily write CSV files as it's necessary to keep track of several indicators (one for each csv file) for many different sd_algorithm instances (one for each column).
pub struct CSVWriter {
    /// Names of the columns. For instance, the benchmarked algorithm names.
    columns: Vec<String>,
    /// A Map containing the writers for all the possible files to be written.
    writers: HashMap<String, Writer<File>>,
}
/// Relative path of the directory where the csv files will be saved in.
const CSV_DIR: &str = "./csv_dir";
/// Extension of csv files.
const CSV_EXT: &str = ".csv";

impl CSVWriter {
    /// Constructor for the CSVWriter.
    ///
    /// # Arguments
    /// * `columns` - Vector of strings containing the column names.
    ///
    /// # Returns
    /// An instance of CSVWriter initialized with column names.
    ///
    /// # Examples
    /// ```
    /// use delegation::csv_writer::CSVWriter;
    ///
    /// let csv_writer: CSVWriter = CSVWriter::new(vec!["first name".to_string(), "last name".to_string()]).unwrap();
    /// ```
    pub fn new(columns: Vec<String>) -> Result<Self, String> {
        let csv_dir: &Path = Path::new(CSV_DIR);
        Self::check_dir_existence_or_create(csv_dir)?;

        Ok(CSVWriter {
            columns,
            writers: HashMap::new(),
        })
    }

    /// A utility function to check whether the csv directory exists or not
    fn check_dir_existence_or_create(csv_dir: &Path) -> Result<(), String> {
        if !metadata(csv_dir).is_ok() {
            // directory does not exist
            match create_dir(csv_dir) {
                Ok(_) => {}
                Err(err) => return Err(format!("Error in creating CSV folder: [{err}]")),
            };
        }
        Ok(())
    }

    /// Adds a new file writer to the CSVWriter object to keep track of yet another key indicator.
    ///
    /// # Arguments
    /// * `filename` - String containing the name of the csv file to be written.
    ///
    /// # Returns
    /// The result of the operation or a string containing an error.
    ///
    /// # Examples
    /// ```
    /// use delegation::csv_writer::CSVWriter;
    ///
    /// let mut csv_writer: CSVWriter = CSVWriter::new(vec!["Employee ID".to_string(), "First Name".to_string(), "Last Name".to_string()]).unwrap();
    /// csv_writer.add_file(&String::from("Office")).unwrap();
    /// ```
    pub fn add_file(&mut self, filename: &String) -> Result<(), String> {
        let mut filename_with_extension: String = filename.clone();
        filename_with_extension.push_str(CSV_EXT);

        let csv_dir: &Path = Path::new(CSV_DIR);
        Self::check_dir_existence_or_create(csv_dir)?;
        let full_path = csv_dir.join(filename_with_extension);

        let file = match File::create(full_path) {
            Ok(file) => file,
            Err(err) => return Err(format!("Error in creating file for CSV Writer: [{err}]")),
        };

        let writer = Writer::from_writer(file);
        match self.writers.insert(filename.clone(), writer) {
            None => {}
            Some(_) => return Err(format!("HashMap already has a writer for {filename} key")),
        };

        self.write_record_to_file(filename, self.columns.clone())?;

        Ok(())
    }

    /// Writes a record to a file that was previously added to the CSVWriter.
    ///
    /// # Arguments
    /// * `filename` - String containing the name of the csv file.
    /// * `record`  - Record containing the data to be serialized in the file.
    ///
    /// # Returns
    /// The result of the operation or a string containing an error.
    ///
    /// # Examples
    ///
    /// ```
    /// use delegation::csv_writer::CSVWriter;
    ///
    /// let mut csv_writer: CSVWriter = CSVWriter::new(vec!["Employee ID".to_string(), "First Name".to_string(), "Last Name".to_string()]).unwrap();
    /// csv_writer.add_file(&String::from("Office")).unwrap();
    /// csv_writer.write_record_to_file(&String::from("Office"), vec!["0000", "Albert", "Einstein"]).unwrap();
    /// csv_writer.write_record_to_file(&String::from("Office"), vec!["0001", "Leonhard", "Euler"]).unwrap();
    /// ```
    pub fn write_record_to_file<S: Serialize + std::fmt::Debug>(
        &mut self,
        filename: &String,
        record: S,
    ) -> Result<(), String> {
        let writer: &mut Writer<File> = match self.writers.get_mut(filename) {
            None => return Err(format!("Filename {filename} was not found in map")),
            Some(writer) => writer,
        };

        match writer.serialize(record) {
            Ok(_) => Ok(()),
            Err(err) => Err(format!("Error in writing record: [{err}]")),
        }
    }
}

impl Drop for CSVWriter {
    /// Function that is called whenever a CSVWriter file is dropped so to correctly flush the writers.
    fn drop(&mut self) {
        for (_, writer) in self.writers.iter_mut() {
            writer.flush().unwrap();
        }
    }
}
