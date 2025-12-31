document.addEventListener("DOMContentLoaded", function () {
    const keys = document.querySelectorAll(".key");

    keys.forEach((key) => {
        key.addEventListener("click", () => {
            key.classList.add("active");
            const note = key.getAttribute("data-note");
            const audio = document.getElementById(note);
            audio.currentTime = 0;
            audio.play();
            audio.addEventListener("ended", () => {
                key.classList.remove("active");
            });
        });
    });
});

document.body.style.fontFamily = "Arial, sans-serif";



class Scale {
    constructor(name, notes = []) {
        this.name = name;
        this.notes = notes;
    }
}

const scales = {
    'Major': [0, 2, 4, 5, 7, 9, 11],
    'Minor': [0, 2, 3, 5, 7, 8, 10],
    'Pentatonic Major' : [0, 2, 4, 7, 9],
    'Pentatonic Minor' : [0, 3, 5, 7, 10],
    'MOLT 1': [0, 2, 4, 6, 8, 10],           /*(Whole tone)*/
    'MOLT 2': [0, 1, 3, 4, 6, 7, 9, 10],    /*(Octatonic, Diminished, Whole-Half, Half-Whole)*/
    'MOLT 3': [0, 2, 3, 4, 6, 7, 8, 10,11],
    'MOLT 4': [0, 1, 2, 5, 6, 7, 8, 11], 
    'MOLT 5': [0, 1, 5, 6, 7, 11],
    'MOLT 6': [0, 2, 4, 5, 6, 8, 10, 11],
    'MOLT 7': [0, 1, 2, 3, 5, 6, 7, 8, 9, 11],
    'Overtone (Theoretical)': [0, 12, 19, 24, 28, 31, 34, 36, 38, 40, 42, 43, 45, 46, 47, 48],
    'Overtone (Audible)': [0, 12, 19, 24, 28, 31, 36, 38, 40, 43, 47, 48]
};

document.addEventListener("DOMContentLoaded", function() {
    const selectScaleButton = document.querySelector('.selectScaleButton');
    const scaleDropdown = document.querySelector('.select-Dropdown');

    selectScaleButton.addEventListener('click', function() {
        scaleDropdown.classList.toggle('show');
    });
});

const startNoteButtons = document.querySelectorAll('.startNoteButton');
const scaleButtons = document.querySelectorAll('.scaleButton');

startNoteButtons.forEach(button => {
    button.addEventListener('click', function() {
        startNoteButtons.forEach(btn => btn.classList.remove('active'));
        this.classList.add('active');

        const selectedNote = this.textContent;
        const selectedScale = document.querySelector('.scaleButton.active').textContent;

        scaleSelector(selectedNote, selectedScale);
    });
});

scaleButtons.forEach(button => {
    button.addEventListener('click', function() {
        scaleButtons.forEach(btn => btn.classList.remove('active'));
        this.classList.add('active');

        const selectedNote = document.querySelector('.startNoteButton.active').textContent;
        const selectedScale = this.textContent;

        scaleSelector(selectedNote, selectedScale);
    });
});

const keysArray = Array.from(document.querySelectorAll('.key'));

function scaleSelector(selectedNote, selectedScale) {
    // Clear existing highlights
    keysArray.forEach(key => {
        key.classList.remove('highlighted');
    });

    const scale = scales[selectedScale];

    for (let i = 0; i < keysArray.length; i++) {
        const key = keysArray[i];
        const keyDataNote = key.getAttribute('data-note').replace(/\d/g, '');

        if (keyDataNote === selectedNote) {
            key.classList.add('highlighted');

            if (selectedScale === 'Overtone (Theoretical)' || selectedScale === 'Overtone (Audible)') {
                for (let interval of scale) {
                    const targetIndex1 = i + interval;
                    if (targetIndex1 >= 0 && targetIndex1 < keysArray.length) {
                        keysArray[targetIndex1].classList.add('highlighted');
                    }
                };
                return
            }
            
            else{
                for (let interval of scale) {
                    const targetIndex1 = i + interval;
                    if (targetIndex1 >= 0 && targetIndex1 < keysArray.length) {
                        keysArray[targetIndex1].classList.add('highlighted');
                    }

                    const targetIndex2 = i - (12 - interval);
                    if (targetIndex2 >= 0 && targetIndex2 < keysArray.length) {
                        keysArray[targetIndex2].classList.add('highlighted');
                    }
                };
            }
        }
    }
}


const findScaleButtons = document.querySelectorAll('.findNoteButton');
const findScaleRunButton = document.querySelector('.findScaleRunButton');

document.addEventListener("DOMContentLoaded", function() {
    const findScaleButton = document.querySelector('.findScaleButton');
    const findDropdown = document.querySelector('.find-Dropdown');

    findScaleButton.addEventListener('click', function() {
        findDropdown.classList.toggle('show');
    });
});

const noteNames = ['A', 'Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab'];

const noteMapping = {
    "A": 0,
    "Bb": 1,
    "B": 2,
    "C": 3,
    "Db": 4,
    "D": 5,
    "Eb": 6,
    "E": 7,
    "F": 8,
    "Gb": 9,
    "G": 10,
    "Ab": 11
};

const selectedNoteNumbers = [];

findScaleButtons.forEach(button => {
    button.addEventListener('click', function() {
        const noteNumber = noteMapping[button.textContent];
        if (this.classList.contains('active')) {
            this.classList.remove('active');
            const index = selectedNoteNumbers.indexOf(noteNumber);
            if (index !== -1) {
                selectedNoteNumbers.splice(index, 1);
            }
        } else {
            this.classList.add('active');
            selectedNoteNumbers.push(noteNumber);
        }
    });
});

findScaleRunButton.addEventListener('click', function() {
    if (selectedNoteNumbers.length >= 3) {
        findScales(selectedNoteNumbers);
    } else {
        alert("Please choose at least 3 notes.");
    }
});

function displayFoundScales(foundScales) {
    const foundScalesContainer = document.querySelector('.foundScales');
    foundScalesContainer.innerHTML = '';
    foundScales.forEach(scale => {
        const scaleElement = document.createElement('div');
        scaleElement.textContent = scale;
        foundScalesContainer.appendChild(scaleElement);
    });
}

function findScales(selectedNotes) {
    const foundScales = [];

    for (const scaleName in scales) {
        const scaleNotes = scales[scaleName]; // scales[scaleName] is an array of note intervals
        for (let i = 0; i < 12; i++) { // Root note
            let inScale = true;

            for (const selectedNote of selectedNotes) { 
                const transposedNote = (selectedNote + i) % 12;

                // Check if transposed note exists in the scale
                if (!scaleNotes.some(note => note % 12 === transposedNote)) {
                    inScale = false;
                    break;
                }
            }

            if (inScale) {
                // Add the root note and scale name to the found scales
                foundScales.push(noteNames[(24 - i) % 12] + " " + scaleName);
            }
        }
    }

    console.log(foundScales);

    // Display the found scales
    displayFoundScales(foundScales);
}
